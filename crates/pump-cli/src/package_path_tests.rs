use std::collections::BTreeSet;

use crate::package::{Role, SourcePackage};
use crate::package_validation::{safe_path, validate_package};

#[test]
fn parent_directory_paths_are_rejected_independently_of_capabilities() {
    assert!(
        safe_path(
            std::path::Path::new("."),
            std::path::Path::new("../pattern.wasm")
        )
        .is_err()
    );
}

#[cfg(unix)]
#[test]
fn symlinked_directories_cannot_escape_the_manifest_root() {
    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    std::fs::write(outside.path().join("pattern.wasm"), b"outside").expect("fixture");
    std::os::unix::fs::symlink(outside.path(), root.path().join("linked")).expect("link");
    assert!(safe_path(root.path(), std::path::Path::new("linked/pattern.wasm")).is_err());
}

fn pattern(key: &str) -> SourcePackage {
    SourcePackage {
        key: key.to_owned(),
        name: key.to_owned(),
        version: "1.0.0".to_owned(),
        role: Role::Pattern,
        component: "pattern.wasm".into(),
        exports: vec!["render".to_owned()],
        contract: "pump.pattern/v1".to_owned(),
        capabilities: Vec::new(),
        dependencies: Vec::new(),
    }
}

#[test]
fn two_pattern_packages_can_publish_the_same_role_export() {
    let mut keys = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut exports = BTreeSet::new();
    validate_package(&pattern("left"), &mut keys, &mut names, &mut exports).expect("left");
    validate_package(&pattern("right"), &mut keys, &mut names, &mut exports).expect("right");
}

#[test]
fn undeclared_export_dispatch_is_rejected() {
    let mut package = pattern("pattern");
    package.exports = vec!["not-render".to_owned()];
    assert!(
        validate_package(
            &package,
            &mut BTreeSet::new(),
            &mut BTreeSet::new(),
            &mut BTreeSet::new()
        )
        .is_err()
    );
}
