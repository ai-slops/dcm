use std::collections::BTreeSet;

use anyhow::{Context, Result, bail, ensure};

use crate::package::{PackageLock, Role};
use crate::package_session::InvocationReport;

pub fn validate(
    lock_bytes: Option<&[u8]>,
    report_bytes: Option<&[u8]>,
    author: &str,
) -> Result<()> {
    match (lock_bytes, report_bytes) {
        (None, None) => Ok(()),
        (Some(lock_bytes), Some(report_bytes)) => {
            ensure!(
                lock_bytes.len() <= 256 * 1024 && report_bytes.len() <= 256 * 1024,
                "package extension exceeds size limit"
            );
            let lock: PackageLock =
                serde_json::from_slice(lock_bytes).context("decode bundled package lock")?;
            crate::package_validation::validate_lock(&lock)?;
            let song = lock
                .packages
                .iter()
                .find(|package| package.key == lock.song)
                .context("missing locked song")?;
            ensure!(
                song.sha256 == author,
                "locked song does not match bundled author"
            );
            let report: InvocationReport =
                serde_json::from_slice(report_bytes).context("decode invocation report")?;
            ensure!(
                report.schema_version == 1,
                "unsupported invocation report schema"
            );
            ensure!(
                report.package_lock_sha256 == crate::bundle::digest(lock_bytes),
                "invocation report lock digest mismatch"
            );
            ensure!(
                report.invocations.len()
                    <= usize::try_from(crate::package_session::REGISTRY_ATTEMPTS)?,
                "invocation report exceeds call limit"
            );
            let mut occurrences = BTreeSet::new();
            for invocation in report.invocations {
                let package = lock
                    .packages
                    .iter()
                    .find(|package| package.key == invocation.package_key)
                    .context("invocation package is not locked")?;
                ensure!(
                    package.sha256 == invocation.package_sha256,
                    "invocation package digest mismatch"
                );
                ensure!(
                    package.exports.contains(&invocation.export),
                    "invocation export is not locked"
                );
                ensure!(
                    !invocation.occurrence.is_empty() && invocation.occurrence.len() <= 128,
                    "invalid invocation occurrence"
                );
                match package.role {
                    Role::Song => bail!("song cannot be invoked through registry"),
                    Role::Pattern => {
                        ensure!(
                            invocation.style_policy.is_none(),
                            "pattern cannot report a style policy"
                        );
                        ensure!(
                            occurrences.insert(invocation.occurrence),
                            "duplicate pattern invocation occurrence"
                        );
                    }
                    Role::Style => {
                        let policy = invocation
                            .style_policy
                            .context("missing validated style policy")?;
                        ensure!(
                            policy.primary_weight > 0 && policy.variation_weight > 0,
                            "invalid reported style weights"
                        );
                    }
                }
            }
            Ok(())
        }
        (Some(_), None) | (None, Some(_)) => {
            bail!("package lock and invocation report must appear together")
        }
    }
}
