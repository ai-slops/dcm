use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, ensure};

use crate::chart_bundle::{
    AUTHOR_COMPONENT, CONTRACT, LIMITS, MANIFEST, Manifest, PLAN, PROGRAM, REPORT,
    RUNTIME_COMPONENT,
};

const REQUIRED_FILES: [&str; 7] = [
    AUTHOR_COMPONENT,
    PLAN,
    LIMITS,
    CONTRACT,
    PROGRAM,
    RUNTIME_COMPONENT,
    REPORT,
];

pub fn required_files(manifest: &Manifest) -> impl Iterator<Item = &'static str> {
    REQUIRED_FILES
        .into_iter()
        .chain(
            crate::chart_bridge::FILES
                .into_iter()
                .take(if manifest.package_bridge.is_some() {
                    4
                } else {
                    0
                }),
        )
}

pub fn reject_unknown_files(root: &Path, manifest: &Manifest) -> Result<()> {
    let mut allowed: BTreeSet<&str> = required_files(manifest).collect();
    allowed.insert(MANIFEST);
    allowed.insert(crate::chart_signing::SIGNATURE_FILE);
    for entry in fs::read_dir(root).context("read chart bundle directory")? {
        let entry = entry.context("read chart bundle entry")?;
        let name = entry.file_name();
        let name = name
            .to_str()
            .context("chart bundle filename is not UTF-8")?;
        ensure!(
            allowed.contains(name),
            "unexpected chart bundle file: {name}"
        );
    }
    Ok(())
}
