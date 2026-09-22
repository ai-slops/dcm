use std::fs;

use crate::bundle::{Artifacts, verify, write};

#[test]
fn verify_rejects_tampered_artifact() {
    // Given
    let temp = tempfile::tempdir().expect("tempdir");
    let author = temp.path().join("author");
    let runtime = temp.path().join("runtime");
    fs::write(&author, b"author").expect("author");
    fs::write(&runtime, b"runtime").expect("runtime");
    let root = temp.path().join("bundle");
    write(
        &root,
        &Artifacts {
            author: b"author",
            runtime: b"runtime",
            plan: b"plan",
            analysis: b"analysis",
            package_lock: None,
            invocation_report: None,
        },
    )
    .expect("bundle");
    fs::write(root.join("runtime-plan.bin"), b"tampered").expect("tamper");

    // When
    let error = verify(&root).expect_err("tamper must fail");

    // Then
    assert!(error.to_string().contains("runtime-plan.bin"));
}
