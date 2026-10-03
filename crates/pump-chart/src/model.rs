use serde::{Deserialize, Deserializer, Serialize};

pub type NodeId = u32;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
pub struct Fraction {
    pub(crate) numerator: u128,
    pub(crate) denominator: u128,
}

impl<'de> Deserialize<'de> for Fraction {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RawFraction {
            numerator: u128,
            denominator: u128,
        }

        let raw = RawFraction::deserialize(deserializer)?;
        Self::new(raw.numerator, raw.denominator).map_err(serde::de::Error::custom)
    }
}

impl Ord for Fraction {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        crate::fraction::compare(*self, *other)
    }
}

impl PartialOrd for Fraction {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Fraction {
    pub const ZERO: Self = Self {
        numerator: 0,
        denominator: 1,
    };
    pub const ONE: Self = Self {
        numerator: 1,
        denominator: 1,
    };

    pub fn new(numerator: u128, denominator: u128) -> Result<Self, crate::FractionError> {
        crate::fraction::reduce(numerator, denominator)
    }

    pub const fn numerator(self) -> u128 {
        self.numerator
    }
    pub const fn denominator(self) -> u128 {
        self.denominator
    }

    pub fn checked_add(self, other: Self) -> Result<Self, crate::FractionError> {
        crate::fraction::checked_add(self, other)
    }

    pub fn checked_mul(self, other: Self) -> Result<Self, crate::FractionError> {
        crate::fraction::checked_mul(self, other)
    }

    pub fn checked_div(self, other: Self) -> Result<Self, crate::FractionError> {
        crate::fraction::checked_div(self, other)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SignedFraction {
    pub negative: bool,
    pub magnitude: Fraction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TempoSegment {
    pub start_tick: u64,
    pub micros_per_beat: Fraction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Music {
    pub duration_ticks: u64,
    pub ticks_per_beat: u32,
    pub offset_micros: i64,
    pub tempo: Vec<TempoSegment>,
    pub audio_sha256: [u8; 32],
    pub reference_accents: Vec<u64>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub struct Note {
    pub tick: u64,
    pub panel_mask: u16,
    pub hold_ticks: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Chart {
    pub ticks_per_beat: u32,
    pub span_ticks: u64,
    pub notes: Vec<Note>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WeightedNode {
    pub node: NodeId,
    pub weight: u128,
    pub key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Node {
    Tap {
        panel_mask: u16,
        key: String,
    },
    Hold {
        panel_mask: u16,
        duration_ticks: u64,
        key: String,
    },
    Rest {
        duration_ticks: u64,
        key: String,
    },
    Sequence {
        children: Vec<NodeId>,
        key: String,
    },
    Parallel {
        children: Vec<NodeId>,
        key: String,
    },
    Repeat {
        child: NodeId,
        count: u32,
        key: String,
    },
    Choice {
        branches: Vec<WeightedNode>,
        key: String,
    },
    Mirror {
        child: NodeId,
        key: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub music: Music,
    pub nodes: Vec<Node>,
    pub provenance: Vec<String>,
    pub root: NodeId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub max_nodes: u32,
    pub max_depth: u32,
    pub max_edges: u64,
    pub max_derivations: u32,
    pub max_trace_notes: u32,
    pub max_total_events: u64,
    pub max_work: u64,
    pub max_string_bytes: u32,
    pub max_codec_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_nodes: crate::MAX_NODES,
            max_depth: crate::MAX_DEPTH,
            max_edges: crate::MAX_EDGES,
            max_derivations: crate::MAX_DERIVATIONS,
            max_trace_notes: crate::MAX_TRACE_NOTES,
            max_total_events: crate::MAX_TOTAL_EVENTS,
            max_work: crate::MAX_ENUMERATION_WORK,
            max_string_bytes: crate::MAX_STRING_BYTES,
            max_codec_bytes: crate::MAX_CODEC_BYTES,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    pub node: NodeId,
    pub occurrence: u64,
    pub branch: u32,
    pub semantic_key: String,
    pub provenance: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Derivation {
    pub chart: Chart,
    pub prior_mass: Fraction,
    pub decisions: Vec<Decision>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Enumeration {
    pub derivations: Vec<Derivation>,
    pub total_prior_mass: Fraction,
    pub work: u64,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub struct CandidateId(pub [u8; 32]);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WeightedChart {
    pub chart: Chart,
    pub prior_mass: Fraction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    pub id: CandidateId,
    pub chart: Chart,
    pub weight: u128,
    pub original_prior_mass: Fraction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryPolicy {
    pub recent_window: u32,
    pub max_request_history: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RuntimeProgram {
    pub music: Music,
    pub candidates: Vec<Candidate>,
    pub history_policy: HistoryPolicy,
    pub original_mass: Fraction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GenerationRequest {
    pub seed: [u8; 32],
    pub history: Vec<CandidateId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GeneratedChart {
    pub candidate_id: CandidateId,
    pub chart: Chart,
    pub program_sha256: [u8; 32],
    pub request_sha256: [u8; 32],
    pub base_ratio: Fraction,
    pub history_conditioned_ratio: Fraction,
    pub eligible_weight: u128,
    pub allow_repeat_fallback: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Frame {
    pub tick: u64,
    pub releases: u16,
    pub presses: u16,
    pub taps: u16,
}
