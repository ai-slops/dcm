use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, ensure};

use crate::package::{
    LockedPackage, PATTERN_CONTRACT, PackageLock, Role, STYLE_CONTRACT, SourcePackage,
};

pub fn validate_lock(lock: &PackageLock) -> Result<()> {
    ensure!(lock.schema_version == 1, "unsupported package lock schema");
    ensure!(
        !lock.packages.is_empty() && lock.packages.len() <= crate::package::PACKAGE_LIMIT,
        "invalid locked package count"
    );
    let mut keys = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut exports = BTreeSet::new();
    for entry in &lock.packages {
        ensure!(
            entry.sha256.len() == 64
                && entry
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "invalid package digest"
        );
        let package = SourcePackage {
            key: entry.key.clone(),
            name: entry.name.clone(),
            version: entry.version.clone(),
            role: entry.role,
            component: PathBuf::new(),
            exports: entry.exports.clone(),
            contract: entry.contract.clone(),
            capabilities: entry.capabilities.clone(),
            dependencies: entry.dependencies.clone(),
        };
        validate_package(&package, &mut keys, &mut names, &mut exports)?;
        for values in [&entry.exports, &entry.capabilities, &entry.dependencies] {
            ensure!(
                values.windows(2).all(|pair| pair[0] < pair[1]),
                "lock collections must be sorted and unique"
            );
        }
    }
    ensure!(
        lock.packages
            .windows(2)
            .all(|pair| pair[0].key < pair[1].key),
        "lock packages must be sorted"
    );
    validate_graph(&lock.song, &lock.packages)
}

const ALLOWED_CAPABILITIES: [&str; 3] = ["pump.tap", "pump.mirror", "pump.sequence"];

pub fn validate_package(
    package: &SourcePackage,
    keys: &mut BTreeSet<String>,
    names: &mut BTreeSet<String>,
    exports: &mut BTreeSet<String>,
) -> Result<()> {
    ensure!(
        valid_token(&package.key) && valid_token(&package.name),
        "invalid package key or name"
    );
    ensure!(
        valid_version(&package.version),
        "invalid exact package version"
    );
    ensure!(keys.insert(package.key.clone()), "duplicate package key");
    ensure!(names.insert(package.name.clone()), "duplicate package name");
    ensure!(
        !package.exports.is_empty(),
        "package must declare an export"
    );
    for export in &package.exports {
        ensure!(valid_token(export), "invalid export name");
        ensure!(
            exports.insert(format!("{}:{export}", package.key)),
            "duplicate package export"
        );
    }
    let expected_export = match package.role {
        Role::Song => "build",
        Role::Pattern => "render",
        Role::Style => "policy",
    };
    ensure!(
        package.exports == [expected_export],
        "schema v1 requires the role's single public export"
    );
    match package.role {
        Role::Song => ensure!(package.contract == "pump.song/v1", "song contract mismatch"),
        Role::Pattern => ensure!(
            package.contract == PATTERN_CONTRACT,
            "pattern contract mismatch"
        ),
        Role::Style => ensure!(
            package.contract == STYLE_CONTRACT,
            "style contract mismatch"
        ),
    }
    if package.role != Role::Song {
        ensure!(
            package.dependencies.is_empty(),
            "leaf package dependencies are unsupported in schema v1"
        );
    }
    for capability in &package.capabilities {
        ensure!(
            ALLOWED_CAPABILITIES.contains(&capability.as_str()),
            "unsupported capability: {capability}"
        );
    }
    Ok(())
}

pub fn validate_graph(song: &str, packages: &[LockedPackage]) -> Result<()> {
    let selected = packages
        .iter()
        .find(|package| package.key == song)
        .context("song package key is unknown")?;
    ensure!(
        selected.role == Role::Song,
        "selected package is not a song"
    );
    ensure!(
        packages
            .iter()
            .filter(|package| package.role == Role::Song)
            .count()
            == 1,
        "manifest must contain exactly one song"
    );
    ensure!(
        packages.iter().any(|package| package.role == Role::Pattern),
        "manifest needs a pattern package"
    );
    ensure!(
        packages.iter().any(|package| package.role == Role::Style),
        "manifest needs a style package"
    );
    let expected: BTreeSet<&str> = packages
        .iter()
        .filter(|package| package.role != Role::Song)
        .map(|package| package.key.as_str())
        .collect();
    let declared: BTreeSet<&str> = selected.dependencies.iter().map(String::as_str).collect();
    ensure!(
        declared == expected,
        "song dependencies must exactly name every locked leaf package"
    );
    Ok(())
}

pub fn safe_path(root: &Path, relative: &Path) -> Result<PathBuf> {
    ensure!(
        !relative.as_os_str().is_empty() && !relative.is_absolute(),
        "component path must be relative"
    );
    ensure!(
        relative
            .components()
            .all(|part| matches!(part, Component::Normal(_))),
        "component path is unsafe"
    );
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part.as_os_str());
        let metadata = std::fs::symlink_metadata(&path).context("inspect package path")?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "component path contains a symbolic link"
        );
    }
    Ok(path)
}

pub fn sorted_unique(mut values: Vec<String>, label: &str) -> Result<Vec<String>> {
    values.sort();
    let original = values.len();
    values.dedup();
    ensure!(values.len() == original, "duplicate {label}");
    Ok(values)
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn valid_version(value: &str) -> bool {
    value.split('.').count() == 3
        && value
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}
