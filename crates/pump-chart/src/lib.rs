#![forbid(unsafe_code)]

mod chart;
mod codec;
mod decode;
mod decode_generation;
mod encode;
mod enumerate;
mod enumerate_combine;
mod error;
mod fraction;
mod limits;
mod model;
mod runtime;
mod timing;
mod validate;

pub use chart::{frames, normalize_chart, validate_chart};
pub use codec::{
    decode_generated_chart, decode_generation_request, decode_plan, decode_runtime_program,
    encode_generated_chart, encode_generation_request, encode_plan, encode_plan_with_limits,
    encode_runtime_program, encode_runtime_program_with_limits,
};
pub use enumerate::enumerate;
pub use error::{
    CodecError, EnumerateError, FractionError, RuntimeError, TimingError, ValidationError,
};
pub use limits::validate_limits;
pub use model::{
    Candidate, CandidateId, Chart, Decision, Derivation, Enumeration, Fraction, Frame,
    GeneratedChart, GenerationRequest, HistoryPolicy, Limits, Music, Node, NodeId, Note, Plan,
    RuntimeProgram, SignedFraction, TempoSegment, WeightedChart, WeightedNode,
};
pub use runtime::{build_runtime, candidate_id, generate};
pub use timing::{elapsed_time, song_time};
pub use validate::{validate_music, validate_plan};

pub const FORMAT_VERSION: u16 = 2;
pub const PANEL_COUNT: u8 = 10;
pub const PANEL_MASK: u16 = 0x03ff;
pub const MAX_DERIVATIONS: u32 = 4_096;
pub const MAX_NODES: u32 = 4_096;
pub const MAX_DEPTH: u32 = 128;
pub const MAX_EDGES: u64 = 16_384;
pub const MAX_TRACE_NOTES: u32 = 65_536;
pub const MAX_TOTAL_EVENTS: u64 = 1_048_576;
pub const MAX_ENUMERATION_WORK: u64 = 4_194_304;
pub const MAX_STRING_BYTES: u32 = 256;
pub const MAX_CODEC_BYTES: u64 = 64 * 1_024 * 1_024;
pub const MAX_REQUEST_HISTORY: u32 = 256;
pub const MIRROR_PANEL_MAP: [u8; 10] = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
