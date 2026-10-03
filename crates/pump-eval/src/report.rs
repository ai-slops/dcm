use pump_chart::{Fraction, RuntimeProgram};
use serde::{Deserialize, Serialize};

use crate::{Contact, EvalContract, FramePath, RouteWindow};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assessment {
    pub schema_version: u16,
    pub accepted: bool,
    pub execution: ExecutionReport,
    pub difficulty: DifficultyReport,
    pub intents: IntentReport,
    pub rejections: Vec<Rejection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionReport {
    pub model_version: u16,
    pub feasible: bool,
    pub best_path: Option<FramePath>,
    pub alternative_path_exists: bool,
    pub min_objectives: MetricVector,
    pub max_objectives: MetricVector,
    pub min_total_objective: u64,
    pub max_total_objective: u64,
    pub earliest_infeasible_frame: Option<u32>,
    pub feasible_contacts_by_frame: Vec<Vec<Contact>>,
    pub route_windows: Vec<RouteWindow>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricVector {
    pub movement: u64,
    pub brackets: u64,
    pub crossover: u64,
    pub hold_occupancy: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DifficultyReport {
    pub model: String,
    pub uncalibrated: bool,
    pub minimum: DifficultySignals,
    pub maximum: DifficultySignals,
    pub local_windows: Vec<LocalWindow>,
    pub rejections: Vec<Rejection>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DifficultySignals {
    pub density: u64,
    pub movement: u64,
    pub brackets: u64,
    pub hold_occupancy: u64,
    pub local_load: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWindow {
    pub start_tick: u64,
    pub end_tick: u64,
    pub duration_micros: Fraction,
    pub minimum_load: u64,
    pub maximum_load: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentReport {
    pub scores: ScoreVector,
    pub evidence: Vec<IntentEvidence>,
    pub rejections: Vec<Rejection>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScoreVector {
    pub reference_accents: u32,
    pub negative_space: u32,
    pub relational_motifs: u32,
    pub required_credit: u32,
    pub optional_credit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentEvidence {
    pub intent_id: String,
    pub score: u32,
    pub credited: u32,
    pub supporting_note_indices: Vec<u32>,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rejection {
    pub kind: RejectionKind,
    pub rule_id: Option<String>,
    pub observed: Option<u64>,
    pub required: Option<u64>,
    pub frame: Option<u32>,
    pub explanation: String,
}

impl Rejection {
    pub(crate) fn physical(frame: u32) -> Self {
        Self {
            kind: RejectionKind::Physical,
            rule_id: None,
            observed: None,
            required: None,
            frame: Some(frame),
            explanation: "no route in the declared finite two-foot model".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionKind {
    Physical,
    DifficultyMinimum,
    DifficultyMaximum,
    IntentThreshold,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateReport {
    pub candidate_id: String,
    pub original_mass: Fraction,
    pub retained_mass: Fraction,
    pub assessment: Assessment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DistributionReport {
    pub original_mass: Fraction,
    pub retained_mass: Fraction,
    pub rejected_mass: Fraction,
    pub unique_candidates: u32,
    pub retained_candidates: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub scheme: String,
    pub exact_within_model: bool,
    pub covered_candidate_ids: Vec<String>,
    pub report_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompileReport {
    pub schema_version: u16,
    pub contract: EvalContract,
    pub distribution: DistributionReport,
    pub candidates: Vec<CandidateReport>,
    pub certificate: Certificate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Compilation {
    pub runtime: RuntimeProgram,
    pub report: CompileReport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailedCompilation {
    pub distribution: DistributionReport,
    pub candidates: Vec<CandidateReport>,
}
