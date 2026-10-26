use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use pump_chart::{Chart, Music};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_build::read_json;
use crate::chart_cli::{ChartExportUcsArgs, ChartImportUcsArgs};

const UCS_LIMIT: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ExportSummary {
    pub file: PathBuf,
    pub source: &'static str,
    pub certification: Certification,
}

#[derive(Debug, Serialize)]
pub struct Certification {
    pub status: &'static str,
    pub reason: &'static str,
}

pub fn import(args: &ChartImportUcsArgs) -> Result<pump_ucs::UcsChart> {
    let bytes = artifact_io::read(&args.file, UCS_LIMIT)?;
    let audio_sha256 = match args.audio.as_deref() {
        Some(path) => Sha256::digest(artifact_io::read(path, ARTIFACT_LIMIT)?).into(),
        None => [0; 32],
    };
    pump_ucs::parse_ucs(&bytes, audio_sha256).map_err(anyhow::Error::new)
}

pub fn export(args: &ChartExportUcsArgs) -> Result<ExportSummary> {
    let chart: Chart = read_json(&args.chart, "chart")?;
    let music: Music = read_json(&args.music, "music")?;
    let text =
        pump_ucs::render_ucs(&chart, &music, args.mode.into()).map_err(anyhow::Error::new)?;
    write_new(&args.out, text.as_bytes())?;
    Ok(ExportSummary {
        file: args.out.clone(),
        source: "user_edited",
        certification: Certification {
            status: "none",
            reason: "not_generated_from_a_verified_bundle",
        },
    })
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create new UCS output {} (must not exist)", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("write UCS output {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("sync UCS output {}", path.display()))
}
