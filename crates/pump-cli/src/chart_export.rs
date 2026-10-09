use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use pump_chart::{CandidateId, Chart, Fraction, GenerationRequest, Music};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_cli::ChartExportSscArgs;
use crate::chart_runtime::ChartRuntime;
use crate::ssc::{SscInput, render};

const SSC_FILE: &str = "chart.ssc";
const REPLAY_FILE: &str = "replay.json";
const EXPORTER_SEMANTICS: &str = "pump-ssc-export-v2";

#[derive(Serialize)]
pub struct ExportResult {
    directory: PathBuf,
    replay: ReplayDescriptor,
}

#[derive(Serialize)]
struct ReplayDescriptor {
    schema_version: u16,
    exporter_semantics: &'static str,
    source_manifest_sha256: String,
    #[serde(flatten)]
    exact: ReplayExact,
    request: ReplayRequest,
    selection: ReplaySelection,
    artifacts: ReplayArtifacts,
    signature_trust: SignatureTrust,
}

#[derive(Serialize)]
pub(crate) struct ReplayExact {
    chart: Chart,
    music: Music,
}

#[derive(Serialize)]
struct ReplayRequest {
    seed: String,
    history: Vec<String>,
}

#[derive(Serialize)]
struct ReplaySelection {
    candidate_id: String,
    program_sha256: String,
    request_sha256: String,
    base_ratio: Fraction,
    history_conditioned_ratio: Fraction,
    eligible_weight: u128,
    allow_repeat_fallback: bool,
}

#[derive(Serialize)]
struct ReplayArtifacts {
    ssc_file: &'static str,
    ssc_sha256: String,
    audio_file: String,
    audio_sha256: String,
}

#[derive(Serialize)]
struct SignatureTrust {
    status: &'static str,
    trusted_signer: Option<String>,
}

pub(crate) struct ExportFiles<'a> {
    pub ssc: &'a [u8],
    pub audio_name: &'a str,
    pub audio: &'a [u8],
    pub replay: &'a [u8],
}

pub fn export(args: &ChartExportSscArgs) -> Result<ExportResult> {
    ensure_destination_available(&args.out)?;
    let request = request(&args.seed, &args.history)?;
    let audio_name = audio_name(&args.audio)?;
    let bundle = crate::chart_bundle::load(&args.bundle)?;
    pump_eval::reproduce(
        &bundle.plan,
        &bundle.contract,
        &bundle.limits,
        &bundle.program,
        &bundle.report,
    )
    .context("reproduce chart evaluation before SSC export")?;
    let signature_trust = match args.trusted_key.as_deref() {
        Some(key) => {
            let signature =
                crate::chart_signing::verify(&args.bundle, &bundle.manifest_bytes, key)?;
            SignatureTrust {
                status: "trusted",
                trusted_signer: Some(signature.public_key),
            }
        }
        None => SignatureTrust {
            status: "not_checked",
            trusted_signer: None,
        },
    };
    let audio = artifact_io::read(&args.audio, ARTIFACT_LIMIT)?;
    let audio_digest: [u8; 32] = Sha256::digest(&audio).into();
    ensure!(
        audio_digest == bundle.plan.music.audio_sha256,
        "audio SHA-256 does not match Music metadata"
    );
    let generated =
        ChartRuntime::new(&bundle.runtime_component)?.generate(&bundle.program, &request)?;
    let ssc = render(&SscInput {
        music: &bundle.program.music,
        chart: &generated.chart,
        title: &args.title,
        artist: &args.artist,
        audio_file: &audio_name,
    })?;
    let replay = ReplayDescriptor {
        schema_version: 2,
        exporter_semantics: EXPORTER_SEMANTICS,
        source_manifest_sha256: crate::chart_bundle::digest(&bundle.manifest_bytes),
        exact: replay_exact(&generated.chart, &bundle.program.music),
        request: ReplayRequest {
            seed: hex::encode(request.seed),
            history: request
                .history
                .iter()
                .map(|candidate| hex::encode(candidate.0))
                .collect(),
        },
        selection: ReplaySelection {
            candidate_id: hex::encode(generated.candidate_id.0),
            program_sha256: hex::encode(generated.program_sha256),
            request_sha256: hex::encode(generated.request_sha256),
            base_ratio: generated.base_ratio,
            history_conditioned_ratio: generated.history_conditioned_ratio,
            eligible_weight: generated.eligible_weight,
            allow_repeat_fallback: generated.allow_repeat_fallback,
        },
        artifacts: ReplayArtifacts {
            ssc_file: SSC_FILE,
            ssc_sha256: digest(&ssc),
            audio_file: audio_name.clone(),
            audio_sha256: hex::encode(audio_digest),
        },
        signature_trust,
    };
    let mut replay_bytes =
        serde_json::to_vec_pretty(&replay).context("encode replay descriptor")?;
    replay_bytes.push(b'\n');
    ensure!(
        u64::try_from(replay_bytes.len()).context("replay size conversion")? <= ARTIFACT_LIMIT,
        "replay descriptor exceeds size limit"
    );
    publish(
        &args.out,
        &ExportFiles {
            ssc: &ssc,
            audio_name: &audio_name,
            audio: &audio,
            replay: &replay_bytes,
        },
    )?;
    Ok(ExportResult {
        directory: args.out.clone(),
        replay,
    })
}

pub(crate) fn replay_exact(chart: &Chart, music: &Music) -> ReplayExact {
    ReplayExact {
        chart: chart.clone(),
        music: music.clone(),
    }
}

fn request(seed: &str, history: &[String]) -> Result<GenerationRequest> {
    Ok(GenerationRequest {
        seed: crate::chart_generate::decode_32(seed, "seed")?,
        history: history
            .iter()
            .map(|value| crate::chart_generate::decode_32(value, "candidate ID").map(CandidateId))
            .collect::<Result<Vec<_>>>()?,
    })
}

fn audio_name(path: &Path) -> Result<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .context("audio path must have a UTF-8 extension")?
        .to_ascii_lowercase();
    ensure!(
        matches!(extension.as_str(), "wav" | "ogg" | "mp3"),
        "audio extension must be WAV, OGG, or MP3"
    );
    Ok(format!("music.{extension}"))
}

fn ensure_destination_available(root: &Path) -> Result<()> {
    match fs::symlink_metadata(root) {
        Ok(_) => bail!("SSC output directory already exists: {}", root.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("inspect SSC output {}", root.display())),
    }
}

pub(crate) fn publish(root: &Path, files: &ExportFiles<'_>) -> Result<()> {
    fs::create_dir(root).with_context(|| {
        format!(
            "create new SSC output directory {} (must not exist)",
            root.display()
        )
    })?;
    write_new(&root.join(SSC_FILE), files.ssc)?;
    write_new(&root.join(files.audio_name), files.audio)?;
    write_new(&root.join(REPLAY_FILE), files.replay)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create export artifact {}", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("write export artifact {}", path.display()))
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
