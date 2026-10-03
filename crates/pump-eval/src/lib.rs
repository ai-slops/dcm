mod compile;
mod contract;
mod difficulty;
mod error;
mod execution;
mod intent;
mod intent_detect;
mod report;

pub use compile::{compile, reproduce};
pub use contract::{
    CreditPolicy, DifficultyEnvelope, EvalBudgets, EvalContract, FootModel, IntentKind, IntentRule,
    LocalWindowRule, MetricRange, Requiredness,
};
pub use error::{CompileError, EvalError, VerifyError};
pub use execution::{Contact, Foot, FootPose, FramePath, PosePair, RouteWindow};
pub use report::{
    Assessment, CandidateReport, Certificate, Compilation, CompileReport, DifficultyReport,
    DifficultySignals, DistributionReport, ExecutionReport, FailedCompilation, IntentEvidence,
    IntentReport, LocalWindow, MetricVector, Rejection, RejectionKind, ScoreVector,
};

use pump_chart::{Chart, Music};

pub const REPORT_SCHEMA_VERSION: u16 = 2;

pub fn assess(
    chart: &Chart,
    music: &Music,
    contract: &EvalContract,
) -> Result<Assessment, EvalError> {
    contract.validate()?;
    pump_chart::validate_music(music)
        .map_err(|error| EvalError::InvalidChart(error.to_string()))?;
    let chart = pump_chart::normalize_chart(chart)
        .map_err(|error| EvalError::InvalidChart(error.to_string()))?;
    if chart.ticks_per_beat != music.ticks_per_beat || chart.span_ticks != music.duration_ticks {
        return Err(EvalError::InvalidChart(
            "chart grid or span differs from music".into(),
        ));
    }
    if contract
        .difficulty
        .local_windows
        .iter()
        .any(|window| window.width_ticks > music.duration_ticks)
        || contract.intents.iter().any(|intent| match intent.kind {
            IntentKind::ReferenceAccents { tolerance_ticks } => {
                tolerance_ticks > music.duration_ticks
            }
            IntentKind::NegativeSpace { end_tick, .. } => end_tick > music.duration_ticks,
            IntentKind::RelationalMotif { .. } => false,
        })
    {
        return Err(EvalError::InvalidContract(
            "music-bound rule lies outside the music duration",
        ));
    }
    let execution = execution::evaluate(&chart, music, contract)?;
    let difficulty = difficulty::evaluate(&chart, music, contract, &execution)?;
    let intents = intent::evaluate(&chart, music, contract)?;
    let mut rejections = Vec::new();
    if let Some(frame) = execution.earliest_infeasible_frame {
        rejections.push(Rejection::physical(frame));
    }
    rejections.extend(difficulty.rejections.iter().cloned());
    rejections.extend(intents.rejections.iter().cloned());
    Ok(Assessment {
        schema_version: REPORT_SCHEMA_VERSION,
        accepted: rejections.is_empty(),
        execution,
        difficulty,
        intents,
        rejections,
    })
}
