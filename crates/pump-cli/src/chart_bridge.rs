use anyhow::{Context, Result, ensure};
use pump_chart::{Limits, Plan};
use serde::{Deserialize, Serialize};

use crate::chart_build::{self, Inputs, Source};
use crate::chart_bundle;
use crate::chart_cli::ChartBuildOptions;
use crate::package_compile::LockedResolution;

#[cfg(test)]
#[path = "chart_bridge_tests.rs"]
mod tests;

pub const FILES: [&str; 4] = [
    "package.lock.json",
    "package-invocations.json",
    "source-plan-v1.bin",
    "bridge-report.json",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeMetadata {
    pub version: u16,
    pub adapter: String,
    pub source_codec: String,
    pub seed_mapping: String,
    pub package_policy_sha256: String,
}

impl BridgeMetadata {
    pub fn current() -> Result<Self> {
        Ok(Self {
            version: 1,
            adapter: pump_bridge::ADAPTER_VERSION.to_owned(),
            source_codec: "PRTP@1".to_owned(),
            seed_mapping: "v2-new-seeds-v1-replay-unchanged".to_owned(),
            package_policy_sha256: crate::policy::package_digest()?,
        })
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            *self == Self::current()?,
            "unsupported package bridge semantics or policy"
        );
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BridgeReport {
    adapter: String,
    source_plan_sha256: String,
    converted_plan_sha256: String,
    statistics: pump_bridge::BridgeStatistics,
}

pub struct BridgeArtifacts {
    pub metadata: BridgeMetadata,
    pub package_lock: Vec<u8>,
    pub invocations: Vec<u8>,
    pub source_plan: Vec<u8>,
    pub report: Vec<u8>,
}

impl BridgeArtifacts {
    pub fn entries(&self) -> [(&'static str, &[u8]); 4] {
        [
            (FILES[0], &self.package_lock),
            (FILES[1], &self.invocations),
            (FILES[2], &self.source_plan),
            (FILES[3], &self.report),
        ]
    }

    pub fn reproduce(&self, author_sha256: &str, plan: &Plan, limits: &Limits) -> Result<()> {
        self.metadata.validate()?;
        crate::package_bundle::validate(
            Some(&self.package_lock),
            Some(&self.invocations),
            author_sha256,
        )?;
        let source = pump_core::decode_runtime_plan(&self.source_plan)
            .context("decode bridged v1 source plan")?;
        ensure!(
            pump_core::encode_runtime_plan(&source)? == self.source_plan,
            "source v1 plan is not canonical"
        );
        let report: BridgeReport =
            serde_json::from_slice(&self.report).context("decode bridge report")?;
        ensure!(
            report.adapter == self.metadata.adapter,
            "bridge report adapter mismatch"
        );
        ensure!(
            report.source_plan_sha256 == chart_bundle::digest(&self.source_plan),
            "bridge report source digest mismatch"
        );
        let converted = pump_bridge::convert(&source, &plan.music, limits)
            .context("reproduce package bridge")?;
        ensure!(
            converted.plan == *plan,
            "reproduced package bridge Plan differs from bundle"
        );
        ensure!(
            report.statistics == converted.statistics,
            "reproduced bridge statistics differ from bundle"
        );
        let bytes = pump_chart::encode_plan_with_limits(plan, limits)?;
        ensure!(
            report.converted_plan_sha256 == chart_bundle::digest(&bytes),
            "bridge report converted Plan digest mismatch"
        );
        Ok(())
    }
}

pub fn compile(
    input: LockedResolution,
    inputs: Inputs,
    options: &ChartBuildOptions,
) -> Result<chart_bundle::Manifest> {
    let authored = crate::package_compile::build(input)?;
    let source = pump_core::compile(&authored.plan).context("validate source package Plan")?;
    let source_plan = pump_core::encode_runtime_plan(&source)?;
    let conversion = pump_bridge::convert(&source, &inputs.music, &inputs.limits)
        .context("convert source package Plan")?;
    let converted_bytes = pump_chart::encode_plan_with_limits(&conversion.plan, &inputs.limits)?;
    let report = serde_json::to_vec_pretty(&BridgeReport {
        adapter: pump_bridge::ADAPTER_VERSION.to_owned(),
        source_plan_sha256: chart_bundle::digest(&source_plan),
        converted_plan_sha256: chart_bundle::digest(&converted_bytes),
        statistics: conversion.statistics,
    })?;
    let bridge = BridgeArtifacts {
        metadata: BridgeMetadata::current()?,
        package_lock: authored.lock_bytes,
        invocations: authored.invocations,
        source_plan,
        report,
    };
    chart_build::publish(
        Source {
            plan: &conversion.plan,
            author_component: &authored.author_component,
            bridge: Some(&bridge),
        },
        &inputs,
        options,
    )
}
