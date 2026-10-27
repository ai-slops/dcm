use pump_chart::{Music, Note};
use pump_eval::EvalContract;

use crate::chart_cli::UcsModeArg;
use crate::chart_rule_generate::{GenerationRules, RuleGenerationRequest, generate};

fn music() -> anyhow::Result<Music> {
    Ok(serde_json::from_str(include_str!(
        "../../../examples/feedback/music.json"
    ))?)
}

fn contract() -> anyhow::Result<EvalContract> {
    Ok(serde_json::from_str(include_str!(
        "../../../examples/feedback/contract.json"
    ))?)
}

fn hybrid(value: serde_json::Value) -> anyhow::Result<GenerationRules> {
    Ok(serde_json::from_value(value)?)
}

fn generate_hybrid(
    rules: &GenerationRules,
) -> anyhow::Result<crate::chart_rule_generate::RuleGenerationOutput> {
    let music = music()?;
    let contract = contract()?;
    generate(RuleGenerationRequest {
        rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Single,
        seed: [7; 32],
    })
}

fn region(id: &str, name: &str, start: u64, end: u64, mask: u16) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": name,
        "rules": {
            "start_tick": start,
            "end_tick": end,
            "step_ticks": 4,
            "pattern": [{ "choices": [
                { "panel_mask": mask, "hold_ticks": 0, "weight": 1 }
            ] }]
        }
    })
}

#[test]
fn hybrid_generation_composes_fixed_notes_and_automatic_regions() -> anyhow::Result<()> {
    let rules = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [{ "tick": 2, "panel_mask": 16, "hold_ticks": 0 }],
        "regions": [region("00000000-0000-4000-8000-000000000001", "Verse", 4, 12, 1)]
    }))?;

    let output = generate_hybrid(&rules)?;

    assert_eq!(
        output.chart.notes,
        vec![
            Note {
                tick: 2,
                panel_mask: 16,
                hold_ticks: 0
            },
            Note {
                tick: 4,
                panel_mask: 1,
                hold_ticks: 0
            },
            Note {
                tick: 8,
                panel_mask: 1,
                hold_ticks: 0
            },
        ]
    );
    assert!(output.ucs_validation.valid);
    Ok(())
}

#[test]
fn hybrid_generation_rejects_ucs_tail_onset_collision_without_resampling() -> anyhow::Result<()> {
    let rules = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [],
        "regions": [{
            "id": "00000000-0000-4000-8000-000000000001",
            "name": "Collision",
            "rules": {
                "start_tick": 0,
                "end_tick": 8,
                "step_ticks": 4,
                "pattern": [
                    { "choices": [{ "panel_mask": 1, "hold_ticks": 4, "weight": 1 }] },
                    { "choices": [{ "panel_mask": 1, "hold_ticks": 0, "weight": 1 }] }
                ]
            }
        }]
    }))?;

    let error =
        generate_hybrid(&rules).expect_err("a UCS tail cell collision must be a hard error");

    assert!(error.to_string().contains("UCS"));
    Ok(())
}

#[test]
fn hybrid_generation_rejects_fixed_cells_owned_by_a_region() -> anyhow::Result<()> {
    let rules = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [{ "tick": 0, "panel_mask": 1, "hold_ticks": 4 }],
        "regions": [region("00000000-0000-4000-8000-000000000001", "Verse", 4, 12, 2)]
    }))?;

    let error =
        generate_hybrid(&rules).expect_err("fixed hold tails cannot occupy automatic cells");

    assert!(error.to_string().contains("automatic region"));
    Ok(())
}

#[test]
fn hybrid_region_sampling_is_local_to_seed_and_canonical_region_id() -> anyhow::Result<()> {
    let first_id = "00000000-0000-4000-8000-000000000001";
    let second_id = "00000000-0000-4000-8000-000000000002";
    let first_region = serde_json::json!({
        "id": first_id,
        "name": "Verse",
        "rules": {
            "start_tick": 4,
            "end_tick": 12,
            "step_ticks": 4,
            "pattern": [{ "choices": [
                { "panel_mask": 1, "hold_ticks": 0, "weight": 1 },
                { "panel_mask": 2, "hold_ticks": 0, "weight": 1 }
            ] }]
        }
    });
    let baseline = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [],
        "regions": [first_region.clone(), region(second_id, "Chorus", 16, 24, 4)]
    }))?;
    let edited = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [{ "tick": 0, "panel_mask": 16, "hold_ticks": 0 }],
        "regions": [
            { "id": first_id, "name": "Renamed", "rules": first_region["rules"].clone() },
            {
                "id": second_id,
                "name": "Edited",
                "rules": {
                    "start_tick": 16,
                    "end_tick": 24,
                    "step_ticks": 4,
                    "pattern": [{ "choices": [
                        { "panel_mask": 8, "hold_ticks": 2, "weight": 1 }
                    ] }]
                }
            }
        ]
    }))?;

    let baseline_output = generate_hybrid(&baseline)?;
    let edited_output = generate_hybrid(&edited)?;
    let baseline_first: Vec<_> = baseline_output
        .chart
        .notes
        .into_iter()
        .filter(|note| (4..12).contains(&note.tick))
        .collect();
    let edited_first: Vec<_> = edited_output
        .chart
        .notes
        .into_iter()
        .filter(|note| (4..12).contains(&note.tick))
        .collect();

    assert_eq!(baseline_first, edited_first);
    assert_ne!(baseline_output.request_sha256, edited_output.request_sha256);
    Ok(())
}

#[test]
fn hybrid_generation_enforces_total_slot_limit() -> anyhow::Result<()> {
    let regions: Vec<_> = (0..2)
        .map(|index| {
            serde_json::json!({
                "id": format!("00000000-0000-4000-8000-{index:012x}"),
                "name": format!("Region {index}"),
                "rules": {
                    "start_tick": index * 5_000,
                    "end_tick": (index + 1) * 5_000,
                    "step_ticks": 1,
                    "pattern": [{ "choices": [{
                        "panel_mask": 1,
                        "hold_ticks": 0,
                        "weight": 1
                    }] }]
                }
            })
        })
        .collect();
    let rules = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [{ "tick": 12_000, "panel_mask": 1, "hold_ticks": 0 }],
        "regions": regions
    }))?;
    let mut long_music = music()?;
    long_music.duration_ticks = 20_000;
    long_music.reference_accents.clear();
    let contract = contract()?;

    let error = generate(RuleGenerationRequest {
        rules: &rules,
        music: &long_music,
        contract: &contract,
        mode: UcsModeArg::Single,
        seed: [0; 32],
    })
    .expect_err("fixed notes plus slots above 10000 must be rejected");

    assert!(error.to_string().contains("10000"));
    Ok(())
}

#[test]
fn hybrid_generation_enforces_single_masks() -> anyhow::Result<()> {
    let rules = hybrid(serde_json::json!({
        "schema_version": 2,
        "algorithm": "hybrid_regions_v1",
        "fixed_notes": [],
        "regions": [region(
            "00000000-0000-4000-8000-000000000001",
            "Right pad",
            0,
            4,
            32
        )]
    }))?;

    let error = generate_hybrid(&rules).expect_err("Single mode cannot sample right-pad lanes");

    assert!(error.to_string().contains("Single"));
    Ok(())
}
