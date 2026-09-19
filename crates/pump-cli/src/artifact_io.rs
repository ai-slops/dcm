use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result, ensure};

pub const ARTIFACT_LIMIT: u64 = 32 * 1024 * 1024;

pub fn read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect artifact {}", path.display()))?;
    ensure!(
        metadata.is_file(),
        "artifact must be a regular file: {}",
        path.display()
    );
    ensure!(
        metadata.len() <= limit,
        "artifact exceeds size limit: {}",
        path.display()
    );
    let mut bytes = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(
        u64::try_from(bytes.len())? <= limit,
        "artifact grew beyond size limit"
    );
    Ok(bytes)
}
