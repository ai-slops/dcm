use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

use crate::artifact_io;

pub const MANIFEST_LIMIT: u64 = 256 * 1024;
pub const PACKAGE_LIMIT: usize = 16;
pub const TOTAL_COMPONENT_LIMIT: u64 = 128 * 1024 * 1024;
pub const PATTERN_CONTRACT: &str = "pump.pattern/v1";
pub const STYLE_CONTRACT: &str = "pump.style/v1";
use crate::package_validation::{safe_path, sorted_unique, validate_graph, validate_package};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Song,
    Pattern,
    Style,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcePackage {
    pub key: String,
    pub name: String,
    pub version: String,
    pub role: Role,
    pub component: PathBuf,
    pub exports: Vec<String>,
    pub contract: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceManifest {
    pub schema_version: u16,
    pub song: String,
    pub packages: Vec<SourcePackage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedPackage {
    pub key: String,
    pub name: String,
    pub version: String,
    pub role: Role,
    pub sha256: String,
    pub exports: Vec<String>,
    pub contract: String,
    pub capabilities: Vec<String>,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageLock {
    pub schema_version: u16,
    pub song: String,
    pub packages: Vec<LockedPackage>,
}

#[derive(Debug)]
pub struct LoadedResolution {
    pub lock: PackageLock,
    pub components: BTreeMap<String, Vec<u8>>,
}

pub fn read_manifest(path: &Path) -> Result<SourceManifest> {
    let bytes = artifact_io::read(path, MANIFEST_LIMIT)?;
    serde_json::from_slice(&bytes).with_context(|| format!("decode {}", path.display()))
}

pub fn resolve(path: &Path) -> Result<LoadedResolution> {
    let manifest = read_manifest(path)?;
    ensure!(
        manifest.schema_version == 1,
        "unsupported package manifest schema"
    );
    ensure!(!manifest.packages.is_empty(), "package manifest is empty");
    ensure!(
        manifest.packages.len() <= PACKAGE_LIMIT,
        "package count limit exceeded"
    );
    let root = path.parent().context("manifest has no project root")?;
    let mut keys = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut export_keys = BTreeSet::new();
    let mut components = BTreeMap::new();
    let mut locked = Vec::with_capacity(manifest.packages.len());
    let mut total_bytes = 0_u64;
    for package in manifest.packages {
        validate_package(&package, &mut keys, &mut names, &mut export_keys)?;
        let component = safe_path(root, &package.component)?;
        let bytes = artifact_io::read(&component, crate::artifact_io::ARTIFACT_LIMIT)?;
        total_bytes = total_bytes
            .checked_add(u64::try_from(bytes.len())?)
            .context("package byte count overflow")?;
        ensure!(
            total_bytes <= TOTAL_COMPONENT_LIMIT,
            "total package bytes limit exceeded"
        );
        let digest = crate::bundle::digest(&bytes);
        components.insert(package.key.clone(), bytes);
        locked.push(LockedPackage {
            key: package.key,
            name: package.name,
            version: package.version,
            role: package.role,
            sha256: digest,
            exports: sorted_unique(package.exports, "exports")?,
            contract: package.contract,
            capabilities: sorted_unique(package.capabilities, "capabilities")?,
            dependencies: sorted_unique(package.dependencies, "dependencies")?,
        });
    }
    locked.sort_by(|left, right| left.key.cmp(&right.key));
    validate_graph(&manifest.song, &locked)?;
    Ok(LoadedResolution {
        lock: PackageLock {
            schema_version: 1,
            song: manifest.song,
            packages: locked,
        },
        components,
    })
}

pub fn ensure_compatible(required: &LockedPackage, candidate: &LockedPackage) -> Result<()> {
    ensure!(required.role == candidate.role, "package role mismatch");
    ensure!(
        required.contract == candidate.contract,
        "package contract mismatch"
    );
    ensure!(
        required.exports == candidate.exports,
        "package exports mismatch"
    );
    ensure!(
        required.capabilities == candidate.capabilities,
        "package capabilities mismatch"
    );
    ensure!(
        required.dependencies == candidate.dependencies,
        "package dependencies mismatch"
    );
    Ok(())
}
