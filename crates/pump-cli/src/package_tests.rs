use std::fs;

use crate::package::{LockedPackage, Role};
use crate::package_session::{BuilderSession, HostBuilder, REGISTRY_ATTEMPTS};

fn package(role: Role, digest: &str) -> LockedPackage {
    LockedPackage {
        key: "shared".to_owned(),
        name: "shared".to_owned(),
        version: "1.2.3".to_owned(),
        role,
        sha256: digest.to_owned(),
        exports: vec!["render".to_owned()],
        contract: "pump.pattern/v1".to_owned(),
        capabilities: vec!["pump.tap".to_owned()],
        dependencies: Vec::new(),
    }
}

#[test]
fn compatibility_accepts_changed_binary_when_public_contract_matches() {
    // Given
    let required = package(Role::Pattern, "old");
    let candidate = package(Role::Pattern, "new");

    // When
    let result = crate::package::ensure_compatible(&required, &candidate);

    // Then
    assert!(result.is_ok());
}

#[test]
fn compatibility_rejects_breaking_contract_change() {
    // Given
    let required = package(Role::Pattern, "old");
    let mut candidate = package(Role::Pattern, "new");
    candidate.contract = "pump.pattern/v2".to_owned();

    // When
    let error =
        crate::package::ensure_compatible(&required, &candidate).expect_err("contract must fail");

    // Then
    assert!(error.to_string().contains("contract"));
}

#[test]
fn resolver_rejects_parent_path_and_unsupported_capability() {
    // Given
    let temp = tempfile::tempdir().expect("tempdir");
    let manifest = temp.path().join("pump.package.json");
    fs::write(
        &manifest,
        r#"{"schema_version":1,"song":"song","packages":[{"key":"song","name":"song","version":"1.0.0","role":"song","component":"../song.wasm","exports":["build"],"contract":"pump.song/v1","capabilities":["network"],"dependencies":[]}]}"#,
    )
    .expect("manifest");

    // When
    let error = crate::package::resolve(&manifest).expect_err("unsafe manifest must fail");

    // Then
    assert!(error.to_string().contains("unsupported capability"));
}

#[test]
fn resolver_rejects_duplicate_package_export() {
    // Given
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("a.wasm"), b"a").expect("a");
    fs::write(temp.path().join("b.wasm"), b"b").expect("b");
    let manifest = temp.path().join("pump.package.json");
    fs::write(
        &manifest,
        r#"{"schema_version":1,"song":"a","packages":[{"key":"a","name":"a","version":"1.0.0","role":"song","component":"a.wasm","exports":["build","build"],"contract":"pump.song/v1"}]}"#,
    )
    .expect("manifest");

    // When
    let error = crate::package::resolve(&manifest).expect_err("duplicate export must fail");

    // Then
    assert!(error.to_string().contains("duplicate package export"));
}

#[test]
fn duplicate_occurrence_and_registry_quota_are_preflight_failures() {
    // Given
    let mut session = BuilderSession::new(pump_core::Limits::default());
    session
        .charge_registry(Some("verse"))
        .expect("first occurrence");

    // When
    let duplicate = session
        .charge_registry(Some("verse"))
        .expect_err("duplicate must fail");
    for _ in 2..REGISTRY_ATTEMPTS {
        session.charge_registry(None).expect("within quota");
    }
    let quota = session.charge_registry(None).expect_err("quota must fail");

    // Then
    assert!(duplicate.to_string().contains("duplicate"));
    assert!(quota.to_string().contains("budget"));
    assert!(!session.poisoned);
}

#[test]
fn builder_views_reject_foreign_handles() {
    // Given
    let shared = std::sync::Arc::new(std::sync::Mutex::new(BuilderSession::new(
        pump_core::Limits::default(),
    )));
    let mut first = HostBuilder::child(
        shared.clone(),
        "first".to_owned(),
        "trusted:first".to_owned(),
    );
    let second = HostBuilder::child(shared, "second".to_owned(), "trusted:second".to_owned());
    let handle = first.alias(pump_core::NodeId(0)).expect("alias");

    // When
    let error = second
        .resolve(handle)
        .expect_err("foreign handle must fail");

    // Then
    assert!(error.to_string().contains("foreign"));
}

#[test]
fn failed_child_after_mutation_poisons_session() {
    // Given
    let mut session = BuilderSession::new(pump_core::Limits::default());
    let before = session.node_count();
    session
        .builder
        .as_mut()
        .expect("builder")
        .tap(1, 1, "node", "trusted")
        .expect("tap");

    // When
    session.poison_if_mutated(before);

    // Then
    assert!(session.poisoned);
    assert!(session.charge_hostcall().is_err());
}
