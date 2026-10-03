use std::fs;

use crate::artifact_io::ARTIFACT_LIMIT;
use crate::chart_bundle::{self, Artifacts};

#[test]
fn oversized_artifact_is_rejected_before_bundle_directory_creation() -> anyhow::Result<()> {
    let parent = tempfile::tempdir()?;
    let root = parent.path().join("bundle");
    let oversized = vec![0_u8; usize::try_from(ARTIFACT_LIMIT)? + 1];
    let artifacts = Artifacts {
        author_component: &oversized,
        plan: &[],
        limits: &[],
        contract: &[],
        program: &[],
        runtime_component: &[],
        report: &[],
        audio_sha256: "00",
    };

    let error = match chart_bundle::write(&root, &artifacts) {
        Ok(_) => return Err(anyhow::anyhow!("oversized artifact unexpectedly succeeded")),
        Err(error) => error,
    };

    assert!(error.to_string().contains("size limit"));
    assert!(fs::symlink_metadata(root).is_err());
    Ok(())
}
