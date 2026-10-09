use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use pump_chart::{Limits, Plan, RuntimeProgram};
use pump_eval::{CompileReport, EvalContract};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
pub use crate::chart_bridge::{BridgeArtifacts, BridgeMetadata};
use crate::chart_bundle_files::{reject_unknown_files, required_files};

pub const MANIFEST: &str = "manifest.json";
pub const AUTHOR_COMPONENT: &str = "author.component.wasm";
pub const PLAN: &str = "author.plan";
pub const LIMITS: &str = "limits.json";
pub const CONTRACT: &str = "contract.json";
pub const PROGRAM: &str = "runtime.program";
pub const RUNTIME_COMPONENT: &str = "runtime.component.wasm";
pub const REPORT: &str = "report.json";

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u16,
    pub compiler_version: String,
    pub chart_model_version: u16,
    pub evaluation_report_version: u16,
    pub runtime_abi: String,
    pub random_scheme: String,
    pub game_mode: String,
    pub certification: String,
    pub audio_sha256: String,
    pub files: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_bridge: Option<BridgeMetadata>,
}

pub struct Bundle {
    pub manifest_bytes: Vec<u8>,
    pub plan: Plan,
    pub limits: Limits,
    pub contract: EvalContract,
    pub program: RuntimeProgram,
    pub runtime_component: Vec<u8>,
    pub report: CompileReport,
}

pub struct Artifacts<'a> {
    pub author_component: &'a [u8],
    pub plan: &'a [u8],
    pub limits: &'a [u8],
    pub contract: &'a [u8],
    pub program: &'a [u8],
    pub runtime_component: &'a [u8],
    pub report: &'a [u8],
    pub audio_sha256: &'a str,
    pub bridge: Option<&'a BridgeArtifacts>,
}

pub fn write(root: &Path, artifacts: &Artifacts<'_>) -> Result<Manifest> {
    let mut entries = vec![
        (AUTHOR_COMPONENT, artifacts.author_component),
        (PLAN, artifacts.plan),
        (LIMITS, artifacts.limits),
        (CONTRACT, artifacts.contract),
        (PROGRAM, artifacts.program),
        (RUNTIME_COMPONENT, artifacts.runtime_component),
        (REPORT, artifacts.report),
    ];
    if let Some(bridge) = artifacts.bridge {
        bridge.metadata.validate()?;
        entries.extend(bridge.entries());
    }
    for (name, bytes) in &entries {
        ensure!(
            u64::try_from(bytes.len()).context("artifact size conversion")? <= ARTIFACT_LIMIT,
            "chart bundle artifact exceeds size limit: {name}"
        );
    }
    let files = entries
        .iter()
        .map(|(name, bytes)| ((*name).to_owned(), digest(bytes)))
        .collect();
    let manifest = Manifest {
        schema_version: 2,
        compiler_version: env!("CARGO_PKG_VERSION").to_owned(),
        chart_model_version: pump_chart::FORMAT_VERSION,
        evaluation_report_version: pump_eval::REPORT_SCHEMA_VERSION,
        runtime_abi: "pump:chart/runtime@0.2.0".to_owned(),
        random_scheme: "sha256-chart-selection-v2".to_owned(),
        game_mode: "pump-double-10".to_owned(),
        certification: "exact-within-declared-model".to_owned(),
        audio_sha256: artifacts.audio_sha256.to_owned(),
        files,
        package_bridge: artifacts.bridge.map(|bridge| bridge.metadata.clone()),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).context("encode chart manifest")?;
    ensure!(
        manifest_bytes.len() <= 65_536,
        "chart manifest exceeds size limit"
    );
    fs::create_dir(root).with_context(|| {
        format!(
            "create new chart bundle {} (must not exist)",
            root.display()
        )
    })?;
    for (name, bytes) in entries {
        fs::write(root.join(name), bytes).with_context(|| format!("write chart bundle {name}"))?;
    }
    fs::write(root.join(MANIFEST), manifest_bytes).context("write chart manifest")?;
    Ok(manifest)
}

pub fn load(root: &Path) -> Result<Bundle> {
    let manifest_bytes = artifact_io::read(&root.join(MANIFEST), 65_536)?;
    let manifest: Manifest =
        serde_json::from_slice(&manifest_bytes).context("decode chart manifest")?;
    validate_manifest(&manifest)?;
    reject_unknown_files(root, &manifest)?;
    let author_component = checked(root, &manifest, AUTHOR_COMPONENT)?;
    ensure!(!author_component.is_empty(), "author component is empty");
    let plan_bytes = checked(root, &manifest, PLAN)?;
    let limits_bytes = checked(root, &manifest, LIMITS)?;
    let contract_bytes = checked(root, &manifest, CONTRACT)?;
    let program_bytes = checked(root, &manifest, PROGRAM)?;
    let runtime_component = checked(root, &manifest, RUNTIME_COMPONENT)?;
    let report_bytes = checked(root, &manifest, REPORT)?;
    let limits = serde_json::from_slice(&limits_bytes).context("decode compile limits")?;
    let plan =
        pump_chart::decode_plan(&plan_bytes, &limits).context("decode canonical author plan")?;
    let contract = serde_json::from_slice(&contract_bytes).context("decode evaluation contract")?;
    let program = pump_chart::decode_runtime_program(&program_bytes, &limits)
        .context("decode runtime program")?;
    let report = serde_json::from_slice(&report_bytes).context("decode compile report")?;
    ensure!(
        hex::encode(plan.music.audio_sha256) == manifest.audio_sha256,
        "music audio digest differs from manifest"
    );
    if let Some(metadata) = &manifest.package_bridge {
        let bridge = BridgeArtifacts {
            metadata: metadata.clone(),
            package_lock: checked(root, &manifest, crate::chart_bridge::FILES[0])?,
            invocations: checked(root, &manifest, crate::chart_bridge::FILES[1])?,
            source_plan: checked(root, &manifest, crate::chart_bridge::FILES[2])?,
            report: checked(root, &manifest, crate::chart_bridge::FILES[3])?,
        };
        bridge.reproduce(&digest(&author_component), &plan, &limits)?;
    }
    Ok(Bundle {
        manifest_bytes,
        plan,
        limits,
        contract,
        program,
        runtime_component,
        report,
    })
}

pub fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn validate_manifest(manifest: &Manifest) -> Result<()> {
    ensure!(
        manifest.schema_version == 2,
        "unsupported chart manifest schema"
    );
    ensure!(
        manifest.compiler_version == env!("CARGO_PKG_VERSION"),
        "unsupported chart compiler version"
    );
    ensure!(
        manifest.chart_model_version == pump_chart::FORMAT_VERSION,
        "unsupported chart model version"
    );
    ensure!(
        manifest.evaluation_report_version == pump_eval::REPORT_SCHEMA_VERSION,
        "unsupported evaluation report version"
    );
    ensure!(
        manifest.runtime_abi == "pump:chart/runtime@0.2.0",
        "unsupported chart runtime ABI"
    );
    ensure!(
        manifest.random_scheme == "sha256-chart-selection-v2",
        "unsupported chart random scheme"
    );
    ensure!(
        manifest.game_mode == "pump-double-10",
        "unsupported chart game mode"
    );
    ensure!(
        manifest.certification == "exact-within-declared-model",
        "unsupported certification claim"
    );
    ensure!(
        manifest.files.len() == required_files(manifest).count(),
        "chart manifest file set differs from schema 2"
    );
    if let Some(bridge) = &manifest.package_bridge {
        bridge.validate()?;
    }
    for required in required_files(manifest) {
        ensure!(
            manifest.files.contains_key(required),
            "chart manifest omits {required}"
        );
    }
    Ok(())
}

fn checked(root: &Path, manifest: &Manifest, name: &str) -> Result<Vec<u8>> {
    let expected = manifest
        .files
        .get(name)
        .context("manifest file digest missing")?;
    let bytes = artifact_io::read(&root.join(name), ARTIFACT_LIMIT)?;
    ensure!(
        digest(&bytes) == *expected,
        "chart artifact digest mismatch: {name}"
    );
    Ok(bytes)
}
