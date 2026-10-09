use pump_chart::{Fraction, Limits, Music, TempoSegment};

use super::{BridgeArtifacts, BridgeMetadata, BridgeReport};
use crate::package::{LockedPackage, PackageLock, Role};
use crate::package_session::InvocationReport;

fn fixture() -> anyhow::Result<(BridgeArtifacts, pump_chart::Plan, String)> {
    let mut builder = pump_core::Builder::new(pump_core::Limits::default());
    let root = builder.tap(1, 1, "tap", "source:test")?;
    let source = pump_core::compile(&builder.finish(root)?)?;
    let source_plan = pump_core::encode_runtime_plan(&source)?;
    let music = Music {
        duration_ticks: 1,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: vec![0],
    };
    let converted = pump_bridge::convert(&source, &music, &Limits::default())?;
    let author = crate::chart_bundle::digest(b"song");
    let packages = [
        ("pattern", Role::Pattern, "render", "pump.pattern/v1"),
        ("song", Role::Song, "build", "pump.song/v1"),
        ("style", Role::Style, "policy", "pump.style/v1"),
    ]
    .into_iter()
    .map(|(key, role, export, contract)| LockedPackage {
        key: key.to_owned(),
        name: key.to_owned(),
        version: "1.0.0".to_owned(),
        role,
        sha256: crate::chart_bundle::digest(key.as_bytes()),
        exports: vec![export.to_owned()],
        contract: contract.to_owned(),
        capabilities: Vec::new(),
        dependencies: if role == Role::Song {
            vec!["pattern".to_owned(), "style".to_owned()]
        } else {
            Vec::new()
        },
    })
    .collect();
    let package_lock = serde_json::to_vec(&PackageLock {
        schema_version: 1,
        song: "song".to_owned(),
        packages,
    })?;
    let invocations = serde_json::to_vec(&InvocationReport {
        schema_version: 1,
        package_lock_sha256: crate::chart_bundle::digest(&package_lock),
        invocations: Vec::new(),
    })?;
    let report = serde_json::to_vec(&BridgeReport {
        adapter: pump_bridge::ADAPTER_VERSION.to_owned(),
        source_plan_sha256: crate::chart_bundle::digest(&source_plan),
        converted_plan_sha256: crate::chart_bundle::digest(&pump_chart::encode_plan(
            &converted.plan,
        )?),
        statistics: converted.statistics,
    })?;
    Ok((
        BridgeArtifacts {
            metadata: BridgeMetadata::current()?,
            package_lock,
            invocations,
            source_plan,
            report,
        },
        converted.plan,
        author,
    ))
}

#[test]
fn linked_package_bridge_reproduces_without_source_components() -> anyhow::Result<()> {
    let (bridge, plan, author) = fixture()?;
    bridge.reproduce(&author, &plan, &Limits::default())
}

#[test]
fn plausible_but_different_converted_plan_is_rejected() -> anyhow::Result<()> {
    let (bridge, mut plan, author) = fixture()?;
    for node in &mut plan.nodes {
        if let pump_chart::Node::Tap { panel_mask, .. } = node {
            *panel_mask = 2;
        }
    }
    let error = bridge
        .reproduce(&author, &plan, &Limits::default())
        .expect_err("conversion must match");
    assert!(error.to_string().contains("reproduced package bridge Plan"));
    Ok(())
}

#[test]
fn forged_bridge_statistics_are_rejected_even_when_other_links_match() -> anyhow::Result<()> {
    let (mut bridge, plan, author) = fixture()?;
    let mut report: BridgeReport = serde_json::from_slice(&bridge.report)?;
    report.statistics.source_derivations += 1;
    bridge.report = serde_json::to_vec(&report)?;
    let error = bridge
        .reproduce(&author, &plan, &Limits::default())
        .expect_err("statistics must reproduce");
    assert!(error.to_string().contains("bridge statistics"));
    Ok(())
}

#[test]
fn wrong_author_and_unknown_adapter_are_rejected() -> anyhow::Result<()> {
    let (mut bridge, plan, author) = fixture()?;
    assert!(
        bridge
            .reproduce(&"00".repeat(32), &plan, &Limits::default())
            .is_err()
    );
    bridge.metadata.version = 2;
    assert!(
        bridge
            .reproduce(&author, &plan, &Limits::default())
            .is_err()
    );
    Ok(())
}

#[test]
fn corrupted_source_plan_is_rejected_before_conversion() -> anyhow::Result<()> {
    let (mut bridge, plan, author) = fixture()?;
    bridge.source_plan.push(0xff);
    assert!(
        bridge
            .reproduce(&author, &plan, &Limits::default())
            .is_err()
    );
    Ok(())
}
