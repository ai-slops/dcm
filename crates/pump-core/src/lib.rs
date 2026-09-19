#![forbid(unsafe_code)]

mod analysis;
mod codec;
mod compiler;
mod generate;
mod model;
mod prf;

pub use analysis::{Analysis, analyze};
pub use codec::{decode_runtime_plan, decode_trace, encode_runtime_plan, encode_trace};
pub use compiler::{Builder, Limits, compile};
pub use generate::generate;
pub use model::{
    Command, CommandTrace, Node, NodeId, Plan, PlanError, RelationKind, RuntimePlan, ScopeKind,
    WeightedNode,
};
pub use prf::sample_weighted;

pub const FORMAT_VERSION: u16 = 1;
pub const PANEL_COUNT: u8 = 10;
pub const PANEL_MASK: u16 = 0x03ff;
pub const MAX_STRING_BYTES: usize = 256;
