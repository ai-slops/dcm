use anyhow::{Context, Result, ensure};
use pump_chart::Note;
use serde::{Deserialize, Serialize};

use crate::chart_cli::UcsModeArg;
use crate::chart_rule_generate::RuleGenerationRequest;

pub(crate) const MAX_TICK: u64 = 1_000_000;
pub(crate) const MAX_SLOTS: u64 = 10_000;
pub(crate) const MAX_PATTERN_FRAMES: usize = 128;
pub(crate) const MAX_CHOICES: usize = 8;
pub(crate) const SINGLE_MASK: u16 = 0x001f;

#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum GenerationRules {
    WeightedCycleV1(WeightedCycleRules),
    HybridRegionsV1(HybridRules),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WeightedCycleRules {
    pub(crate) schema_version: u8,
    algorithm: WeightedCycleAlgorithm,
    pub(crate) start_tick: u64,
    pub(crate) end_tick: u64,
    pub(crate) step_ticks: u64,
    pub(crate) pattern: Vec<PatternFrame>,
}

#[derive(Debug, Deserialize, Serialize)]
enum WeightedCycleAlgorithm {
    #[serde(rename = "weighted_cycle_v1")]
    WeightedCycleV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HybridRules {
    pub(crate) schema_version: u8,
    algorithm: HybridAlgorithm,
    pub(crate) fixed_notes: Vec<Note>,
    pub(crate) regions: Vec<AutomaticRegion>,
}

#[derive(Debug, Deserialize, Serialize)]
enum HybridAlgorithm {
    #[serde(rename = "hybrid_regions_v1")]
    HybridRegionsV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AutomaticRegion {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) rules: CycleRules,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CycleRules {
    pub(crate) start_tick: u64,
    pub(crate) end_tick: u64,
    pub(crate) step_ticks: u64,
    pub(crate) pattern: Vec<PatternFrame>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PatternFrame {
    pub(crate) choices: Vec<RuleChoice>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuleChoice {
    pub(crate) panel_mask: u16,
    pub(crate) hold_ticks: u64,
    pub(crate) weight: u64,
}

pub(crate) fn validate_weighted_request(
    request: &RuleGenerationRequest<'_>,
    rules: &WeightedCycleRules,
) -> Result<u64> {
    ensure!(
        rules.schema_version == 1,
        "generation rules schema_version must be 1"
    );
    ensure!(rules.start_tick < MAX_TICK, "start_tick is out of range");
    ensure!(
        rules.end_tick > 0 && rules.end_tick <= MAX_TICK,
        "end_tick is out of range"
    );
    ensure!(
        rules.start_tick < rules.end_tick,
        "generation range must be nonempty"
    );
    ensure!(
        rules.end_tick <= request.music.duration_ticks,
        "generation range exceeds music"
    );
    ensure!(
        rules.step_ticks > 0 && rules.step_ticks <= MAX_TICK,
        "step_ticks is out of range"
    );
    ensure!(!rules.pattern.is_empty(), "pattern must not be empty");
    ensure!(
        rules.pattern.len() <= MAX_PATTERN_FRAMES,
        "pattern exceeds 128 frames"
    );
    pump_chart::validate_music(request.music).context("invalid music")?;
    let slots = (rules.end_tick - rules.start_tick).div_ceil(rules.step_ticks);
    ensure!(
        slots <= MAX_SLOTS,
        "generation exceeds the 10000-slot limit"
    );
    for (index, frame) in rules.pattern.iter().enumerate() {
        ensure!(
            !frame.choices.is_empty(),
            "pattern frame {index} has no choices"
        );
        ensure!(
            frame.choices.len() <= MAX_CHOICES,
            "pattern frame {index} exceeds 8 choices"
        );
        for choice in &frame.choices {
            validate_weighted_choice(request, rules, slots, index, choice)?;
        }
    }
    Ok(slots)
}

fn validate_weighted_choice(
    request: &RuleGenerationRequest<'_>,
    rules: &WeightedCycleRules,
    slots: u64,
    pattern_index: usize,
    choice: &RuleChoice,
) -> Result<()> {
    ensure!(choice.panel_mask <= 0x03ff, "panel mask exceeds ten lanes");
    ensure!(choice.hold_ticks <= MAX_TICK, "hold_ticks is out of range");
    ensure!(
        choice.panel_mask != 0 || choice.hold_ticks == 0,
        "a rest cannot have hold duration"
    );
    ensure!(
        choice.weight > 0 && choice.weight <= MAX_TICK,
        "choice weight is out of range"
    );
    ensure!(
        request.mode != UcsModeArg::Single || choice.panel_mask & !SINGLE_MASK == 0,
        "Single mode allows only five left-pad lanes"
    );
    let index = u64::try_from(pattern_index).context("pattern index conversion")?;
    if choice.hold_ticks == 0 || index >= slots {
        return Ok(());
    }
    let period = u64::try_from(rules.pattern.len()).context("pattern length conversion")?;
    let last_slot = index + ((slots - 1 - index) / period) * period;
    let tail = rules
        .start_tick
        .checked_add(
            last_slot
                .checked_mul(rules.step_ticks)
                .context("slot tick overflow")?,
        )
        .and_then(|tick| tick.checked_add(choice.hold_ticks))
        .context("hold tail overflow")?;
    ensure!(
        tail < request.music.duration_ticks,
        "hold tail must precede music end for UCS export"
    );
    Ok(())
}
