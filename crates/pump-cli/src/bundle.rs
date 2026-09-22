use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};

const MANIFEST: &str = "manifest.json";
const LOCK: &str = "manifest.lock.json";
const PLAN: &str = "runtime-plan.bin";
const RUNTIME: &str = "runtime.component.wasm";
const AUTHOR: &str = "author.component.wasm";
const ANALYSIS: &str = "analysis.json";
const PACKAGE_LOCK: &str = "package.lock.json";
const INVOCATION_REPORT: &str = "invocations.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u16,
    pub compiler_version: String,
    pub compiler_config_sha256: String,
    pub author_sha256: String,
    pub runtime_sha256: String,
    pub runtime_plan_sha256: String,
    pub analysis_sha256: String,
    pub runtime_ir_version: u16,
    pub command_abi_version: u16,
    pub random_scheme: String,
    pub mode: String,
    pub certification: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_lock_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invocation_report_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_policy_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lock {
    schema_version: u16,
    manifest_sha256: String,
}

#[derive(Debug, Serialize)]
pub struct Verification {
    pub integrity: bool,
    pub authenticity: bool,
    pub manifest_sha256: String,
    pub note: &'static str,
}

pub struct Bundle {
    pub manifest: Manifest,
    pub plan: Vec<u8>,
    pub runtime: Vec<u8>,
    pub analysis: Vec<u8>,
}

pub struct Artifacts<'a> {
    pub author: &'a [u8],
    pub runtime: &'a [u8],
    pub plan: &'a [u8],
    pub analysis: &'a [u8],
    pub package_lock: Option<&'a [u8]>,
    pub invocation_report: Option<&'a [u8]>,
}

pub fn write(root: &Path, artifacts: &Artifacts<'_>) -> Result<Manifest> {
    fs::create_dir(root)
        .with_context(|| format!("create new bundle {} (must not exist)", root.display()))?;
    let manifest = Manifest {
        schema_version: 1,
        compiler_version: env!("CARGO_PKG_VERSION").to_owned(),
        compiler_config_sha256: crate::policy::digest()?,
        author_sha256: digest(artifacts.author),
        runtime_sha256: digest(artifacts.runtime),
        runtime_plan_sha256: digest(artifacts.plan),
        analysis_sha256: digest(artifacts.analysis),
        runtime_ir_version: pump_core::FORMAT_VERSION,
        command_abi_version: pump_core::FORMAT_VERSION,
        random_scheme: "sha256-path-v1".to_owned(),
        mode: "pump-double-10".to_owned(),
        certification: "development".to_owned(),
        package_lock_sha256: artifacts.package_lock.map(digest),
        invocation_report_sha256: artifacts.invocation_report.map(digest),
        package_policy_sha256: artifacts
            .package_lock
            .map(|_| crate::policy::package_digest())
            .transpose()?,
    };
    fs::write(root.join(AUTHOR), artifacts.author).context("write bundled author")?;
    fs::write(root.join(RUNTIME), artifacts.runtime).context("write bundled runtime")?;
    fs::write(root.join(PLAN), artifacts.plan).context("write runtime plan")?;
    fs::write(root.join(ANALYSIS), artifacts.analysis).context("write analysis")?;
    if let Some(bytes) = artifacts.package_lock {
        fs::write(root.join(PACKAGE_LOCK), bytes).context("write package lock")?;
    }
    if let Some(bytes) = artifacts.invocation_report {
        fs::write(root.join(INVOCATION_REPORT), bytes).context("write invocation report")?;
    }
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).context("encode manifest")?;
    fs::write(root.join(MANIFEST), &manifest_bytes).context("write manifest")?;
    let lock = Lock {
        schema_version: 1,
        manifest_sha256: digest(&manifest_bytes),
    };
    fs::write(
        root.join(LOCK),
        serde_json::to_vec_pretty(&lock).context("encode lock")?,
    )
    .context("write lock")?;
    Ok(manifest)
}

pub fn load(root: &Path) -> Result<Bundle> {
    let manifest_bytes = artifact_io::read(&root.join(MANIFEST), 65_536)?;
    let lock = read_json::<Lock>(&root.join(LOCK))?;
    ensure!(lock.schema_version == 1, "unsupported lock schema");
    let manifest_digest = digest(&manifest_bytes);
    ensure!(
        manifest_digest == lock.manifest_sha256,
        "manifest lock digest mismatch"
    );
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).context("decode manifest")?;
    ensure!(manifest.schema_version == 1, "unsupported manifest schema");
    match (
        &manifest.package_lock_sha256,
        &manifest.package_policy_sha256,
    ) {
        (None, None) => {}
        (Some(_), Some(policy)) => ensure!(
            *policy == crate::policy::package_digest()?,
            "unsupported package compiler policy"
        ),
        (None, Some(_)) | (Some(_), None) => bail!("package policy and lock must appear together"),
    }
    ensure!(
        manifest.compiler_version == env!("CARGO_PKG_VERSION"),
        "unsupported compiler version"
    );
    ensure!(
        manifest.compiler_config_sha256 == crate::policy::digest()?,
        "unsupported compiler policy"
    );
    ensure!(
        manifest.runtime_ir_version == pump_core::FORMAT_VERSION,
        "unsupported runtime IR"
    );
    ensure!(
        manifest.command_abi_version == pump_core::FORMAT_VERSION,
        "unsupported command ABI"
    );
    ensure!(
        manifest.random_scheme == "sha256-path-v1",
        "unsupported random scheme"
    );
    ensure!(manifest.mode == "pump-double-10", "unsupported game mode");
    ensure!(
        manifest.certification == "development",
        "unsupported certification claim"
    );
    check(root, AUTHOR, &manifest.author_sha256)?;
    let runtime = check(root, RUNTIME, &manifest.runtime_sha256)?;
    let plan = check(root, PLAN, &manifest.runtime_plan_sha256)?;
    let analysis = check(root, ANALYSIS, &manifest.analysis_sha256)?;
    let package_lock = check_optional(root, PACKAGE_LOCK, manifest.package_lock_sha256.as_deref())?;
    let invocation_report = check_optional(
        root,
        INVOCATION_REPORT,
        manifest.invocation_report_sha256.as_deref(),
    )?;
    crate::package_bundle::validate(
        package_lock.as_deref(),
        invocation_report.as_deref(),
        &manifest.author_sha256,
    )?;
    pump_core::decode_runtime_plan(&plan).context("validate runtime plan")?;
    Ok(Bundle {
        manifest,
        plan,
        runtime,
        analysis,
    })
}

pub fn verify(root: &Path) -> Result<Verification> {
    load(root)?;
    let manifest_digest = digest(&artifact_io::read(&root.join(MANIFEST), 65_536)?);
    Ok(Verification {
        integrity: true,
        authenticity: false,
        manifest_sha256: manifest_digest,
        note: "hashes prove integrity only; no trusted release signature is configured",
    })
}

pub fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn check(root: &Path, name: &str, expected: &str) -> Result<Vec<u8>> {
    let bytes = artifact_io::read(&root.join(name), ARTIFACT_LIMIT)?;
    let actual = digest(&bytes);
    if actual != expected {
        bail!("artifact digest mismatch: {name}");
    }
    Ok(bytes)
}

fn check_optional(root: &Path, name: &str, expected: Option<&str>) -> Result<Option<Vec<u8>>> {
    if let Some(digest) = expected {
        return Ok(Some(check(root, name, digest)?));
    }
    Ok(None)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    serde_json::from_slice(&artifact_io::read(path, 65_536)?)
        .with_context(|| format!("decode {}", path.display()))
}
