use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{Context, Result, ensure};
use serde::Serialize;

use crate::artifact_store::{ArtifactStore, BlobDigest};
use crate::package::{LoadedResolution, PackageLock};
use crate::package_compile::LockedResolution;

#[derive(Debug, Serialize)]
pub struct CacheReport {
    pub package_lock_sha256: String,
    pub package_count: usize,
    pub unique_blob_count: usize,
}

pub fn cache(manifest: &Path, lock_path: &Path, root: &Path) -> Result<CacheReport> {
    let input = crate::package_compile::load_source(manifest, lock_path)?;
    let store = ArtifactStore::create(root)?;
    let mut unique = BTreeSet::new();
    for package in &input.resolution.lock.packages {
        let bytes = input
            .resolution
            .components
            .get(&package.key)
            .context("resolved package bytes missing")?;
        let digest = BlobDigest::parse(&package.sha256)?;
        store.put(&digest, bytes)?;
        unique.insert(digest);
    }
    Ok(CacheReport {
        package_lock_sha256: crate::bundle::digest(&input.lock_bytes),
        package_count: input.resolution.lock.packages.len(),
        unique_blob_count: unique.len(),
    })
}

pub fn load(lock_path: &Path, root: &Path) -> Result<LockedResolution> {
    let lock_bytes = crate::artifact_io::read(lock_path, crate::package::MANIFEST_LIMIT)?;
    let lock: PackageLock = serde_json::from_slice(&lock_bytes).context("decode package lock")?;
    crate::package_validation::validate_lock(&lock)?;
    let store = ArtifactStore::open(root)?;
    let mut components = BTreeMap::new();
    let mut total = 0_u64;
    for package in &lock.packages {
        let bytes = store
            .read(&BlobDigest::parse(&package.sha256)?)
            .with_context(|| format!("load locked package {}", package.key))?;
        total = total
            .checked_add(u64::try_from(bytes.len())?)
            .context("package byte count overflow")?;
        ensure!(
            total <= crate::package::TOTAL_COMPONENT_LIMIT,
            "total package bytes limit exceeded"
        );
        components.insert(package.key.clone(), bytes);
    }
    Ok(LockedResolution {
        resolution: LoadedResolution { lock, components },
        lock_bytes,
    })
}
