use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use pump_chart::{Chart, Music};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_build::read_json;
use crate::chart_cli::ChartExportEditedSscArgs;
use crate::chart_export::{SSC_FILE, audio_name, digest, ensure_destination_available, write_new};
use crate::ssc::{SscInput, render};

const METADATA_FILE: &str = "edited-export.json";

#[derive(Debug, Serialize)]
pub struct EditedExportResult {
    directory: PathBuf,
    edited_export: EditedExportDescriptor,
}

#[derive(Debug, Serialize)]
struct EditedExportDescriptor {
    schema_version: u16,
    source: &'static str,
    certification: Certification,
    chart: Chart,
    music: Music,
    artifacts: EditedArtifacts,
}

#[derive(Debug, Serialize)]
struct Certification {
    status: &'static str,
    reason: &'static str,
}

#[derive(Debug, Serialize)]
struct EditedArtifacts {
    ssc_file: &'static str,
    ssc_sha256: String,
    audio_file: String,
    audio_sha256: String,
}

struct EditedFiles<'a> {
    audio_file: &'a str,
    ssc: &'a [u8],
    audio: &'a [u8],
    metadata: &'a [u8],
}

pub fn export(args: &ChartExportEditedSscArgs) -> Result<EditedExportResult> {
    let chart: Chart = read_json(&args.chart, "chart")?;
    let chart = pump_chart::normalize_chart(&chart).context("normalize edited chart")?;
    let music: Music = read_json(&args.music, "music")?;
    pump_chart::validate_music(&music).context("validate music metadata")?;
    ensure!(
        chart.ticks_per_beat == music.ticks_per_beat && chart.span_ticks == music.duration_ticks,
        "chart and music grids differ"
    );
    let audio_file = audio_name(&args.audio)?;
    let audio = artifact_io::read(&args.audio, ARTIFACT_LIMIT)?;
    let audio_sha256: [u8; 32] = Sha256::digest(&audio).into();
    ensure!(
        audio_sha256 == music.audio_sha256,
        "audio SHA-256 does not match Music metadata"
    );
    let ssc = render(&SscInput {
        music: &music,
        chart: &chart,
        title: &args.title,
        artist: &args.artist,
        audio_file: &audio_file,
    })?;
    let edited_export = EditedExportDescriptor {
        schema_version: 1,
        source: "user_edited",
        certification: Certification {
            status: "none",
            reason: "not_generated_from_a_verified_bundle",
        },
        chart,
        music,
        artifacts: EditedArtifacts {
            ssc_file: SSC_FILE,
            ssc_sha256: digest(&ssc),
            audio_file: audio_file.clone(),
            audio_sha256: hex::encode(audio_sha256),
        },
    };
    let mut metadata =
        serde_json::to_vec_pretty(&edited_export).context("encode edited export descriptor")?;
    metadata.push(b'\n');
    ensure!(
        u64::try_from(metadata.len()).context("edited export descriptor size conversion")?
            <= ARTIFACT_LIMIT,
        "edited export descriptor exceeds size limit"
    );
    ensure_destination_available(&args.out)?;
    publish(
        &args.out,
        &EditedFiles {
            audio_file: &audio_file,
            ssc: &ssc,
            audio: &audio,
            metadata: &metadata,
        },
    )?;
    Ok(EditedExportResult {
        directory: args.out.clone(),
        edited_export,
    })
}

fn publish(root: &Path, files: &EditedFiles<'_>) -> Result<()> {
    fs::create_dir(root).with_context(|| {
        format!(
            "create new edited SSC output directory {} (must not exist)",
            root.display()
        )
    })?;
    let result = write_new(&root.join(SSC_FILE), files.ssc)
        .and_then(|()| write_new(&root.join(files.audio_file), files.audio))
        .and_then(|()| write_new(&root.join(METADATA_FILE), files.metadata));
    if result.is_err() {
        for name in [SSC_FILE, files.audio_file, METADATA_FILE] {
            let _ = fs::remove_file(root.join(name));
        }
        let _ = fs::remove_dir(root);
    }
    result
}
