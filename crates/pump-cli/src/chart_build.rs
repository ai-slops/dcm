use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use pump_chart::{Limits, Music, Plan};
use pump_eval::EvalContract;
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_bundle::{self, BridgeArtifacts};
use crate::chart_cli::ChartBuildOptions;

pub struct Inputs {
    pub music: Music,
    pub contract: EvalContract,
    pub limits: Limits,
    pub runtime_bytes: Vec<u8>,
}

pub struct Source<'a> {
    pub plan: &'a Plan,
    pub author_component: &'a [u8],
    pub bridge: Option<&'a BridgeArtifacts>,
}

pub fn load(options: &ChartBuildOptions) -> Result<Inputs> {
    let music = read_json(&options.music, "music")?;
    let contract = read_json(&options.contract, "evaluation contract")?;
    let limits = match &options.limits {
        Some(path) => read_json(path, "compile limits")?,
        None => Limits::default(),
    };
    pump_chart::validate_limits(&limits).context("validate compile limits")?;
    pump_chart::validate_music(&music).context("validate music metadata")?;
    verify_audio(options.audio.as_deref(), &music.audio_sha256)?;
    let runtime_bytes = artifact_io::read(&options.runtime, ARTIFACT_LIMIT)?;
    crate::chart_runtime::ChartRuntime::new(&runtime_bytes)?;
    Ok(Inputs {
        music,
        contract,
        limits,
        runtime_bytes,
    })
}

pub fn publish(
    source: Source<'_>,
    inputs: &Inputs,
    options: &ChartBuildOptions,
) -> Result<chart_bundle::Manifest> {
    ensure!(
        source.plan.music == inputs.music,
        "author Plan music differs from the verified input"
    );
    let compilation = match pump_eval::compile(source.plan, &inputs.contract, &inputs.limits) {
        Ok(compilation) => compilation,
        Err(pump_eval::CompileError::NoRetainedCandidates(failed)) => {
            let path = options
                .failure_report
                .clone()
                .unwrap_or_else(|| options.out.with_extension("failure.json"));
            fs::write(
                &path,
                serde_json::to_vec_pretty(&failed).context("encode compilation failure report")?,
            )
            .with_context(|| format!("write compilation failure report {}", path.display()))?;
            bail!(
                "no candidate satisfied the evaluation contract; counterexamples: {}",
                path.display()
            );
        }
        Err(error) => return Err(error).context("evaluate chart plan"),
    };
    ensure!(
        !compilation.runtime.candidates.is_empty(),
        "evaluation retained no deployable candidates"
    );
    let plan = pump_chart::encode_plan_with_limits(source.plan, &inputs.limits)
        .context("encode canonical author plan")?;
    let program =
        pump_chart::encode_runtime_program_with_limits(&compilation.runtime, &inputs.limits)
            .context("encode runtime program")?;
    let limits = serde_json::to_vec_pretty(&inputs.limits)?;
    let contract = serde_json::to_vec_pretty(&inputs.contract)?;
    let report = serde_json::to_vec_pretty(&compilation.report)?;
    chart_bundle::write(
        &options.out,
        &chart_bundle::Artifacts {
            author_component: source.author_component,
            plan: &plan,
            limits: &limits,
            contract: &contract,
            program: &program,
            runtime_component: &inputs.runtime_bytes,
            report: &report,
            audio_sha256: &hex::encode(source.plan.music.audio_sha256),
            bridge: source.bridge,
        },
    )
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path, label: &str) -> Result<T> {
    serde_json::from_slice(&artifact_io::read(path, ARTIFACT_LIMIT)?)
        .with_context(|| format!("decode {label} JSON"))
}

pub fn verify_audio(path: Option<&Path>, expected: &[u8; 32]) -> Result<()> {
    if let Some(path) = path {
        let bytes = artifact_io::read(path, ARTIFACT_LIMIT)?;
        let actual: [u8; 32] = Sha256::digest(&bytes).into();
        ensure!(
            actual == *expected,
            "audio SHA-256 does not match Music metadata"
        );
    }
    Ok(())
}
