#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod expand;
mod lower;

pub const ADAPTER_VERSION: &str = "v1-correlated-plan-to-v2-finite@1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeStatistics {
    pub source_derivations: u32,
    pub unique_charts: u32,
    pub total_prior_mass: pump_chart::Fraction,
    pub work: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Conversion {
    pub plan: pump_chart::Plan,
    pub statistics: BridgeStatistics,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BridgeError {
    #[error("invalid v1 runtime plan: {0}")]
    InvalidSource(#[from] pump_core::PlanError),
    #[error("invalid v2 music or limits: {0}")]
    InvalidTarget(#[from] pump_chart::ValidationError),
    #[error("source duration {source_duration} differs from music duration {music_duration}")]
    DurationMismatch {
        source_duration: u32,
        music_duration: u64,
    },
    #[error("bridge limit exceeded: {0}")]
    LimitExceeded(&'static str),
    #[error("exact arithmetic overflow")]
    ArithmeticOverflow,
    #[error("exact fraction arithmetic failed: {0}")]
    Fraction(#[from] pump_chart::FractionError),
    #[error("reachable source chart is invalid: {0}")]
    InvalidChart(pump_chart::ValidationError),
    #[error("correlated choice identity was reused with a different selector")]
    ChoiceIdentityConflict,
    #[error("v2 runtime lowering failed: {0}")]
    Runtime(#[from] pump_chart::RuntimeError),
    #[error("v2 plan encoding failed: {0}")]
    Codec(#[from] pump_chart::CodecError),
}

/// Converts a canonical v1 runtime plan into a finite v2 plan.
///
/// # Errors
/// Returns [`BridgeError`] when validation, exact expansion, or bounded lowering fails.
pub fn convert(
    source: &pump_core::RuntimePlan,
    music: &pump_chart::Music,
    limits: &pump_chart::Limits,
) -> Result<Conversion, BridgeError> {
    pump_chart::validate_limits(limits)?;
    pump_chart::validate_music(music)?;
    if limits.max_derivations == 0 {
        return Err(BridgeError::LimitExceeded("derivations"));
    }
    let source_bytes = pump_core::encode_runtime_plan(source)?;
    let root_index = usize::try_from(source.root.0).map_err(|_| BridgeError::ArithmeticOverflow)?;
    let source_duration = source
        .nodes
        .get(root_index)
        .ok_or(BridgeError::ArithmeticOverflow)?
        .duration;
    if u64::from(source_duration) != music.duration_ticks {
        return Err(BridgeError::DurationMismatch {
            source_duration,
            music_duration: music.duration_ticks,
        });
    }
    let expansion = expand::expand(source, music, limits)?;
    let statistics = BridgeStatistics {
        source_derivations: u32::try_from(expansion.charts.len())
            .map_err(|_| BridgeError::ArithmeticOverflow)?,
        unique_charts: 0,
        total_prior_mass: expansion.total_mass,
        work: expansion.work,
    };
    lower::lower(music, limits, &source_bytes, expansion.charts, statistics)
}
