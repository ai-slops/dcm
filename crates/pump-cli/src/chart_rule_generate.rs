use anyhow::{Context, Result};
use pump_chart::{Chart, Music, Note};
use pump_eval::{Assessment, EvalContract};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::chart_build::read_json;
use crate::chart_cli::{ChartGenerateRulesArgs, UcsModeArg};
use crate::chart_commands::output;
use crate::chart_rule_model::{HybridRules, WeightedCycleRules};
use crate::cli::OutputFormat;

pub use crate::chart_rule_model::GenerationRules;

pub struct RuleGenerationRequest<'a> {
    pub rules: &'a GenerationRules,
    pub music: &'a Music,
    pub contract: &'a EvalContract,
    pub mode: UcsModeArg,
    pub seed: [u8; 32],
}

#[derive(Debug, Serialize)]
pub struct RuleGenerationOutput {
    schema_version: u8,
    mode: pump_ucs::UcsMode,
    pub chart: Chart,
    pub assessment: Assessment,
    pub ucs_validation: UcsValidation,
    pub request_sha256: String,
    certification: Certification,
}

#[derive(Debug, Serialize)]
pub struct UcsValidation {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct Certification {
    status: &'static str,
    reason: &'static str,
}

#[derive(Serialize)]
struct HashedRequest<'a> {
    schema_version: u8,
    algorithm_version: &'static str,
    mode: &'static str,
    rules: &'a GenerationRules,
    music: &'a Music,
    contract: &'a EvalContract,
    seed: [u8; 32],
}

pub fn run(args: &ChartGenerateRulesArgs, format: OutputFormat) -> Result<()> {
    let rules: GenerationRules = read_json(&args.rules, "generation rules")?;
    let music: Music = read_json(&args.music, "music")?;
    let contract: EvalContract = read_json(&args.contract, "evaluation contract")?;
    let generated = generate(RuleGenerationRequest {
        rules: &rules,
        music: &music,
        contract: &contract,
        mode: args.mode,
        seed: crate::chart_generate::decode_32(&args.seed, "seed")?,
    })?;
    output(&generated, format)
}

pub fn generate(request: RuleGenerationRequest<'_>) -> Result<RuleGenerationOutput> {
    match request.rules {
        GenerationRules::WeightedCycleV1(rules) => generate_weighted(&request, rules),
        GenerationRules::HybridRegionsV1(rules) => generate_hybrid(&request, rules),
    }
}

fn generate_weighted(
    request: &RuleGenerationRequest<'_>,
    rules: &WeightedCycleRules,
) -> Result<RuleGenerationOutput> {
    let slots = crate::chart_rule_model::validate_weighted_request(request, rules)?;
    let request_bytes = serde_json::to_vec(&HashedRequest {
        schema_version: 1,
        algorithm_version: "weighted_cycle_v1",
        mode: mode_name(request.mode),
        rules: request.rules,
        music: request.music,
        contract: request.contract,
        seed: request.seed,
    })
    .context("encode versioned generation request")?;
    let request_sha256: [u8; 32] = Sha256::digest(request_bytes).into();
    let mut notes = Vec::with_capacity(usize::try_from(slots).context("slot count conversion")?);
    for slot in 0..slots {
        let pattern_index =
            usize::try_from(slot).context("pattern index conversion")? % rules.pattern.len();
        let frame = rules
            .pattern
            .get(pattern_index)
            .context("pattern frame is missing")?;
        let weights: Vec<u64> = frame.choices.iter().map(|choice| choice.weight).collect();
        let choice_index =
            crate::chart_rule_sampling::weighted_index(&request_sha256, slot, &weights)?;
        let choice = frame
            .choices
            .get(choice_index)
            .context("sampled choice is missing")?;
        if choice.panel_mask != 0 {
            notes.push(Note {
                tick: rules.start_tick + slot * rules.step_ticks,
                panel_mask: choice.panel_mask,
                hold_ticks: choice.hold_ticks,
            });
        }
    }
    finish_generation(request, notes, request_sha256, false)
}

fn generate_hybrid(
    request: &RuleGenerationRequest<'_>,
    rules: &HybridRules,
) -> Result<RuleGenerationOutput> {
    let region_slots = crate::chart_rule_hybrid::validate(request, rules)?;
    let request_bytes = serde_json::to_vec(&HashedRequest {
        schema_version: 2,
        algorithm_version: "hybrid_regions_v1",
        mode: mode_name(request.mode),
        rules: request.rules,
        music: request.music,
        contract: request.contract,
        seed: request.seed,
    })
    .context("encode versioned generation request")?;
    let request_sha256: [u8; 32] = Sha256::digest(request_bytes).into();
    let mut notes = rules.fixed_notes.clone();
    for (region, slots) in rules.regions.iter().zip(region_slots) {
        crate::chart_rule_hybrid::generate_region(&request.seed, region, slots, &mut notes)?;
    }
    finish_generation(request, notes, request_sha256, true)
}

fn finish_generation(
    request: &RuleGenerationRequest<'_>,
    notes: Vec<Note>,
    request_sha256: [u8; 32],
    require_ucs: bool,
) -> Result<RuleGenerationOutput> {
    let chart = pump_chart::normalize_chart(&Chart {
        ticks_per_beat: request.music.ticks_per_beat,
        span_ticks: request.music.duration_ticks,
        notes,
    })
    .context("generated concrete chart is invalid")?;
    let assessment = pump_eval::assess(&chart, request.music, request.contract)
        .context("assess generated concrete chart")?;
    let mode: pump_ucs::UcsMode = request.mode.into();
    let rendered = pump_ucs::render_ucs(&chart, request.music, mode);
    if require_ucs {
        let text = rendered.context("hybrid generated chart failed UCS validation")?;
        return Ok(build_output(
            chart,
            assessment,
            mode,
            request_sha256,
            UcsValidation {
                valid: true,
                byte_length: Some(text.len()),
                error: None,
            },
        ));
    }
    let ucs_validation = match rendered {
        Ok(text) => UcsValidation {
            valid: true,
            byte_length: Some(text.len()),
            error: None,
        },
        Err(error) => UcsValidation {
            valid: false,
            byte_length: None,
            error: Some(error.to_string().chars().take(1024).collect()),
        },
    };
    Ok(build_output(
        chart,
        assessment,
        mode,
        request_sha256,
        ucs_validation,
    ))
}

fn build_output(
    chart: Chart,
    assessment: Assessment,
    mode: pump_ucs::UcsMode,
    request_sha256: [u8; 32],
    ucs_validation: UcsValidation,
) -> RuleGenerationOutput {
    RuleGenerationOutput {
        schema_version: 1,
        mode,
        chart,
        assessment,
        ucs_validation,
        request_sha256: hex::encode(request_sha256),
        certification: Certification {
            status: "none",
            reason: "not_generated_from_verified_bundle",
        },
    }
}

const fn mode_name(mode: UcsModeArg) -> &'static str {
    match mode {
        UcsModeArg::Single => "Single",
        UcsModeArg::Double => "Double",
    }
}
