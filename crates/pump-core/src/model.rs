use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScopeKind {
    Run,
    Section,
    Phrase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RelationKind {
    Same,
    Different,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeightedNode {
    pub weight: u32,
    pub node: NodeId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Node {
    Tap {
        mask: u16,
        duration: u32,
    },
    Sequence {
        children: Vec<NodeId>,
    },
    Parallel {
        children: Vec<NodeId>,
    },
    Repeat {
        child: NodeId,
        times: u32,
    },
    Choice {
        alternatives: Vec<WeightedNode>,
        duration: u32,
    },
    Scope {
        kind: ScopeKind,
        occurrence_key: String,
        child: NodeId,
    },
    Mirror {
        child: NodeId,
    },
    Relation {
        kind: RelationKind,
        left: NodeId,
        right: NodeId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanNode {
    pub decision_id: String,
    pub provenance: String,
    pub duration: u32,
    pub panel_union: u16,
    pub expansion: u32,
    pub node: Node,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub nodes: Vec<PlanNode>,
    pub root: NodeId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePlan {
    pub nodes: Vec<PlanNode>,
    pub root: NodeId,
    pub max_trace: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Command {
    pub tick: u32,
    pub duration: u32,
    pub panel_mask: u16,
    pub decision_id: String,
    pub provenance: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandTrace {
    pub version: u16,
    pub plan_digest: String,
    pub seed_digest: String,
    pub duration: u32,
    pub commands: Vec<Command>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("panel mask {0:#x} is empty or outside ten panels")]
    InvalidPanelMask(u16),
    #[error("duration must be positive")]
    InvalidDuration,
    #[error("node {referenced} is not a backward reference before node {next}")]
    ForwardReference { referenced: u32, next: u32 },
    #[error("collection must not be empty")]
    EmptyChildren,
    #[error("node budget {limit} exceeded")]
    NodeBudget { limit: u32 },
    #[error("expansion budget {limit} exceeded")]
    ExpansionBudget { limit: u32 },
    #[error("trace budget {limit} exceeded")]
    TraceBudget { limit: u32 },
    #[error("depth budget {limit} exceeded")]
    DepthBudget { limit: u32 },
    #[error("edge budget {limit} exceeded")]
    EdgeBudget { limit: u32 },
    #[error("string byte budget {limit} exceeded")]
    StringBudget { limit: u32 },
    #[error("arithmetic overflow")]
    Overflow,
    #[error("parallel children collide on mask {mask:#x}")]
    PanelCollision { mask: u16 },
    #[error("choice weight must be positive")]
    InvalidWeight,
    #[error("choice durations differ without a sufficient explicit duration")]
    ChoiceDuration,
    #[error("semantic decision id is empty or duplicated: {0}")]
    DecisionId(String),
    #[error("occurrence key must not be empty")]
    OccurrenceKey,
    #[error("relation {kind:?} is violated")]
    RelationViolation { kind: RelationKind },
    #[error("invalid binary format: {0}")]
    InvalidFormat(&'static str),
    #[error("unsupported format version {0}")]
    UnsupportedVersion(u16),
    #[error("noncanonical artifact: {0}")]
    NonCanonical(&'static str),
    #[error("seed must contain exactly 32 bytes")]
    InvalidSeed,
}
