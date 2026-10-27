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

fn rules() -> anyhow::Result<GenerationRules> {
    Ok(serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "algorithm": "weighted_cycle_v1",
        "start_tick": 0,
        "end_tick": 16,
        "step_ticks": 4,
        "pattern": [
            { "choices": [
                { "panel_mask": 1, "hold_ticks": 0, "weight": 1 },
                { "panel_mask": 2, "hold_ticks": 0, "weight": 3 }
            ] },
            { "choices": [{ "panel_mask": 4, "hold_ticks": 0, "weight": 1 }] }
        ]
    }))?)
}

#[test]
fn generation_is_deterministic_for_identical_versioned_request() -> anyhow::Result<()> {
    let rules = rules()?;
    let music = music()?;
    let contract = contract()?;
    let request = RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Double,
        seed: [7; 32],
    };

    let first = generate(request)?;
    let second = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Double,
        seed: [7; 32],
    })?;

    assert_eq!(first.request_sha256, second.request_sha256);
    assert_eq!(first.chart, second.chart);
    assert_eq!(first.chart.notes.len(), 4);
    assert!(first.ucs_validation.valid);
    Ok(())
}

#[test]
fn single_generation_rejects_right_pad_rules_before_sampling() -> anyhow::Result<()> {
    let rules: GenerationRules = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "algorithm": "weighted_cycle_v1",
        "start_tick": 0,
        "end_tick": 4,
        "step_ticks": 4,
        "pattern": [{ "choices": [{ "panel_mask": 32, "hold_ticks": 0, "weight": 1 }] }]
    }))?;
    let music = music()?;
    let contract = contract()?;

    let error = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Single,
        seed: [0; 32],
    })
    .expect_err("Single must not silently become Double");

    assert!(error.to_string().contains("Single"));
    Ok(())
}

#[test]
fn generation_returns_truthful_failed_assessment_without_resampling() -> anyhow::Result<()> {
    let rules: GenerationRules = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "algorithm": "weighted_cycle_v1",
        "start_tick": 0,
        "end_tick": 4,
        "step_ticks": 4,
        "pattern": [{ "choices": [{ "panel_mask": 1, "hold_ticks": 0, "weight": 1 }] }]
    }))?;
    let music = music()?;
    let mut contract = contract()?;
    contract.difficulty.density.minimum = 1_000_000;

    let output = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Double,
        seed: [0; 32],
    })?;

    assert!(!output.assessment.accepted);
    assert_eq!(
        output.chart.notes,
        vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 0
        }]
    );
    Ok(())
}

#[test]
fn generation_rejects_rule_fields_above_shared_million_tick_cap() -> anyhow::Result<()> {
    let rules: GenerationRules = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "algorithm": "weighted_cycle_v1",
        "start_tick": 0,
        "end_tick": 1_000_001,
        "step_ticks": 1_000_000,
        "pattern": [{ "choices": [{ "panel_mask": 1, "hold_ticks": 0, "weight": 1 }] }]
    }))?;
    let mut music = music()?;
    music.duration_ticks = 1_000_002;
    music.reference_accents.clear();
    let contract = contract()?;

    let error = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Single,
        seed: [0; 32],
    })
    .expect_err("rules above the shared field cap must be rejected");

    assert!(error.to_string().contains("end_tick"));
    Ok(())
}

#[test]
fn generation_rejects_a_sampled_concrete_chart_with_overlapping_holds() -> anyhow::Result<()> {
    let rules: GenerationRules = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "algorithm": "weighted_cycle_v1",
        "start_tick": 0,
        "end_tick": 8,
        "step_ticks": 4,
        "pattern": [{ "choices": [{ "panel_mask": 1, "hold_ticks": 8, "weight": 1 }] }]
    }))?;
    let music = music()?;
    let contract = contract()?;

    let error = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: UcsModeArg::Single,
        seed: [0; 32],
    })
    .expect_err("overlap must remain a concrete chart error rather than trigger resampling");

    assert!(
        error
            .to_string()
            .contains("generated concrete chart is invalid")
    );
    Ok(())
}
