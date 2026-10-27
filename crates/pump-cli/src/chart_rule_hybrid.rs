use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use pump_chart::{Chart, Note};
use sha2::{Digest, Sha256};

use crate::chart_cli::UcsModeArg;
use crate::chart_rule_generate::RuleGenerationRequest;
use crate::chart_rule_hybrid_validation::{
    is_canonical_uuid, note_intersects_region, validate_ucs_cells,
};
use crate::chart_rule_model::{
    AutomaticRegion, CycleRules, HybridRules, MAX_CHOICES, MAX_PATTERN_FRAMES, MAX_SLOTS, MAX_TICK,
    SINGLE_MASK,
};

pub(crate) fn validate(
    request: &RuleGenerationRequest<'_>,
    rules: &HybridRules,
) -> Result<Vec<u64>> {
    ensure!(
        rules.schema_version == 2,
        "hybrid generation rules schema_version must be 2"
    );
    ensure!(
        rules.fixed_notes.len() <= 10_000,
        "fixed notes exceed the 10000-event limit"
    );
    ensure!(
        rules.regions.len() <= 64,
        "hybrid generation exceeds 64 regions"
    );
    pump_chart::validate_music(request.music).context("invalid music")?;
    validate_fixed_notes(request, rules)?;
    let mut ids = HashSet::with_capacity(rules.regions.len());
    let mut previous_end = 0;
    let mut total =
        u64::try_from(rules.fixed_notes.len()).context("fixed note count conversion")?;
    let mut slots = Vec::with_capacity(rules.regions.len());
    for region in &rules.regions {
        ensure!(
            is_canonical_uuid(&region.id),
            "region ID must be a canonical lowercase UUID"
        );
        ensure!(ids.insert(region.id.as_str()), "region IDs must be unique");
        ensure!(
            !region.name.is_empty() && region.name.trim() == region.name,
            "region name must be trimmed and nonempty"
        );
        ensure!(
            region.name.chars().count() <= 80,
            "region name exceeds 80 characters"
        );
        ensure!(
            region.rules.start_tick >= previous_end,
            "automatic regions must be sorted and cannot overlap"
        );
        previous_end = region.rules.end_tick;
        let region_slots = validate_cycle(request, region)?;
        total = total
            .checked_add(region_slots)
            .context("hybrid event count overflow")?;
        ensure!(
            total <= MAX_SLOTS,
            "fixed notes and automatic slots exceed the 10000-event limit"
        );
        ensure!(
            rules
                .fixed_notes
                .iter()
                .all(|note| !note_intersects_region(note, region)),
            "fixed note or hold tail occupies an automatic region"
        );
        slots.push(region_slots);
    }
    Ok(slots)
}

pub(crate) fn generate_region(
    seed: &[u8; 32],
    region: &AutomaticRegion,
    slots: u64,
    notes: &mut Vec<Note>,
) -> Result<()> {
    let region_key: [u8; 32] = Sha256::new()
        .chain_update(b"pump-hybrid-region-v1\0")
        .chain_update(seed)
        .chain_update(region.id.as_bytes())
        .finalize()
        .into();
    for slot in 0..slots {
        let pattern_index =
            usize::try_from(slot).context("pattern index conversion")? % region.rules.pattern.len();
        let frame = region
            .rules
            .pattern
            .get(pattern_index)
            .context("pattern frame is missing")?;
        let weights: Vec<u64> = frame.choices.iter().map(|choice| choice.weight).collect();
        let choice_index =
            crate::chart_rule_sampling::weighted_index_hybrid(&region_key, slot, &weights)?;
        let choice = frame
            .choices
            .get(choice_index)
            .context("sampled choice is missing")?;
        if choice.panel_mask != 0 {
            notes.push(Note {
                tick: region.rules.start_tick + slot * region.rules.step_ticks,
                panel_mask: choice.panel_mask,
                hold_ticks: choice.hold_ticks,
            });
        }
    }
    Ok(())
}

fn validate_fixed_notes(request: &RuleGenerationRequest<'_>, rules: &HybridRules) -> Result<()> {
    let chart = Chart {
        ticks_per_beat: request.music.ticks_per_beat,
        span_ticks: request.music.duration_ticks,
        notes: rules.fixed_notes.clone(),
    };
    let normalized = pump_chart::normalize_chart(&chart).context("fixed notes are invalid")?;
    ensure!(
        normalized.notes == rules.fixed_notes,
        "fixed notes must be canonical"
    );
    for note in &rules.fixed_notes {
        ensure!(
            request.mode != UcsModeArg::Single || note.panel_mask & !SINGLE_MASK == 0,
            "Single mode allows only five left-pad lanes"
        );
        let tail = note
            .tick
            .checked_add(note.hold_ticks)
            .context("fixed hold tail overflow")?;
        ensure!(
            note.hold_ticks == 0 || tail < request.music.duration_ticks,
            "fixed hold tail must precede music end for UCS export"
        );
    }
    validate_ucs_cells(&rules.fixed_notes).context("fixed notes violate UCS cell exclusivity")
}

fn validate_cycle(request: &RuleGenerationRequest<'_>, region: &AutomaticRegion) -> Result<u64> {
    let rules = &region.rules;
    ensure!(
        rules.start_tick < MAX_TICK,
        "region start_tick is out of range"
    );
    ensure!(
        rules.end_tick > 0 && rules.end_tick <= MAX_TICK,
        "region end_tick is out of range"
    );
    ensure!(
        rules.start_tick < rules.end_tick,
        "automatic region must be nonempty"
    );
    ensure!(
        rules.end_tick <= request.music.duration_ticks,
        "automatic region exceeds music"
    );
    ensure!(
        rules.step_ticks > 0 && rules.step_ticks <= MAX_TICK,
        "region step_ticks is out of range"
    );
    ensure!(
        !rules.pattern.is_empty(),
        "region pattern must not be empty"
    );
    ensure!(
        rules.pattern.len() <= MAX_PATTERN_FRAMES,
        "region pattern exceeds 128 frames"
    );
    let slots = (rules.end_tick - rules.start_tick).div_ceil(rules.step_ticks);
    for (index, frame) in rules.pattern.iter().enumerate() {
        ensure!(
            !frame.choices.is_empty(),
            "region pattern frame {index} has no choices"
        );
        ensure!(
            frame.choices.len() <= MAX_CHOICES,
            "region pattern frame {index} exceeds 8 choices"
        );
        for choice in &frame.choices {
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
            validate_region_tail(rules, slots, index, choice.hold_ticks)?;
        }
    }
    Ok(slots)
}

fn validate_region_tail(
    rules: &CycleRules,
    slots: u64,
    index: usize,
    hold_ticks: u64,
) -> Result<()> {
    let index = u64::try_from(index).context("pattern index conversion")?;
    if hold_ticks == 0 || index >= slots {
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
        .and_then(|tick| tick.checked_add(hold_ticks))
        .context("hold tail overflow")?;
    ensure!(
        tail < rules.end_tick,
        "generated hold tail must precede automatic region end"
    );
    Ok(())
}
