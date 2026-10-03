use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::EvalError;

const MAX_RULES: usize = 4_096;
const MAX_TEXT_BYTES: usize = 256;
const MAX_NOTES: u32 = 65_536;
const MAX_FRAMES: u32 = 131_072;
const MAX_EVAL_WORK: u64 = 100_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalContract {
    pub schema_version: u16,
    pub foot_model: FootModel,
    pub difficulty: DifficultyEnvelope,
    pub intents: Vec<IntentRule>,
    pub budgets: EvalBudgets,
    pub history_policy: pump_chart::HistoryPolicy,
}

impl EvalContract {
    pub(crate) fn validate(&self) -> Result<(), EvalError> {
        if self.schema_version != 2 || self.foot_model.version != 1 {
            return Err(EvalError::UnsupportedVersion(self.schema_version));
        }
        if self.foot_model.micros_per_panel_unit == 0
            || self.foot_model.bracket_setup_micros == 0
            || self.budgets.max_notes == 0
            || self.budgets.max_frames == 0
            || self.budgets.max_dp_work == 0
            || self.budgets.max_matching_work == 0
            || self.budgets.max_notes > MAX_NOTES
            || self.budgets.max_frames > MAX_FRAMES
            || self.budgets.max_dp_work > MAX_EVAL_WORK
            || self.budgets.max_matching_work > MAX_EVAL_WORK
        {
            return Err(EvalError::InvalidContract(
                "budgets and travel times must be positive",
            ));
        }
        if self.difficulty.label.is_empty()
            || self.difficulty.label.len() > MAX_TEXT_BYTES
            || self.intents.len() > MAX_RULES
            || self.difficulty.local_windows.len() > MAX_RULES
            || u64::try_from(self.intents.len())
                .map_or(true, |count| count > self.budgets.max_matching_work)
            || !valid_range(self.difficulty.density)
            || !valid_range(self.difficulty.movement)
            || !valid_range(self.difficulty.brackets)
            || !valid_range(self.difficulty.hold_occupancy)
            || !valid_range(self.difficulty.local_load)
            || !valid_range(self.difficulty.total)
            || self
                .difficulty
                .local_windows
                .iter()
                .any(|window| window.width_ticks == 0)
        {
            return Err(EvalError::InvalidContract("invalid difficulty envelope"));
        }
        if self.history_policy.recent_window > self.history_policy.max_request_history
            || self.history_policy.max_request_history > pump_chart::MAX_REQUEST_HISTORY
        {
            return Err(EvalError::InvalidContract(
                "recent history window exceeds request history bound",
            ));
        }
        let mut intent_ids = BTreeSet::new();
        for intent in &self.intents {
            let kind_valid = match intent.kind {
                IntentKind::ReferenceAccents { .. } => true,
                IntentKind::NegativeSpace {
                    start_tick,
                    end_tick,
                } => start_tick < end_tick,
                IntentKind::RelationalMotif { minimum_notes, .. } => {
                    minimum_notes >= 2 && minimum_notes <= self.budgets.max_notes
                }
            };
            if intent.id.is_empty()
                || intent.id.len() > MAX_TEXT_BYTES
                || !intent_ids.insert(intent.id.as_str())
                || intent.threshold == 0
                || intent.weight == 0
                || !kind_valid
            {
                return Err(EvalError::InvalidContract("invalid intent rule"));
            }
        }
        Ok(())
    }
}

const fn valid_range(range: MetricRange) -> bool {
    range.minimum <= range.maximum
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FootModel {
    pub version: u16,
    pub micros_per_panel_unit: u64,
    pub bracket_setup_micros: u64,
    pub crossover_penalty: u32,
    pub bracket_penalty: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalBudgets {
    pub max_notes: u32,
    pub max_frames: u32,
    pub max_dp_work: u64,
    pub max_matching_work: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DifficultyEnvelope {
    pub label: String,
    pub density: MetricRange,
    pub movement: MetricRange,
    pub brackets: MetricRange,
    pub hold_occupancy: MetricRange,
    pub local_load: MetricRange,
    pub total: MetricRange,
    pub local_windows: Vec<LocalWindowRule>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricRange {
    pub minimum: u64,
    pub maximum: u64,
}

impl MetricRange {
    pub const fn contains(self, value: u64) -> bool {
        value >= self.minimum && value <= self.maximum
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWindowRule {
    pub width_ticks: u64,
    pub maximum_load: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentRule {
    pub id: String,
    pub kind: IntentKind,
    pub requiredness: Requiredness,
    pub credit_policy: CreditPolicy,
    pub threshold: u32,
    pub weight: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum IntentKind {
    ReferenceAccents {
        tolerance_ticks: u64,
    },
    NegativeSpace {
        start_tick: u64,
        end_tick: u64,
    },
    RelationalMotif {
        minimum_notes: u32,
        mirror_equivalent: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Requiredness {
    Required,
    Optional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditPolicy {
    Exclusive,
    Shared,
}
