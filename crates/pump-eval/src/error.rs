use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EvalError {
    #[error("unsupported evaluation contract version {0}")]
    UnsupportedVersion(u16),
    #[error("invalid evaluation contract: {0}")]
    InvalidContract(&'static str),
    #[error("evaluation arithmetic overflow")]
    ArithmeticOverflow,
    #[error("evaluation frame budget {limit} exceeded")]
    FrameBudget { limit: u32 },
    #[error("evaluation note budget {limit} exceeded")]
    NoteBudget { limit: u32 },
    #[error("evaluation DP work budget {limit} exceeded")]
    DpBudget { limit: u64 },
    #[error("intent matching work budget {limit} exceeded")]
    MatchingBudget { limit: u64 },
    #[error("chart is invalid: {0}")]
    InvalidChart(String),
}

#[derive(Debug, Error)]
pub enum CompileError {
    #[error("enumeration failed: {0}")]
    Enumeration(#[from] pump_chart::EnumerateError),
    #[error("candidate evaluation failed: {0}")]
    Evaluation(#[from] EvalError),
    #[error("exact probability arithmetic failed")]
    ProbabilityArithmetic,
    #[error("runtime construction failed: {0}")]
    Runtime(#[from] pump_chart::RuntimeError),
    #[error("candidate digest collision")]
    DigestCollision,
    #[error("report serialization failed: {0}")]
    ReportEncoding(#[from] serde_json::Error),
    #[error("runtime encoding failed: {0}")]
    RuntimeEncoding(#[from] pump_chart::CodecError),
    #[error("no candidate satisfied the evaluation contract")]
    NoRetainedCandidates(Box<crate::FailedCompilation>),
}

#[derive(Debug, Error)]
pub enum VerifyError {
    #[error("recompilation failed: {0}")]
    Compile(#[from] CompileError),
    #[error("recompiled runtime differs from the expected runtime")]
    RuntimeMismatch,
    #[error("recompiled report differs from the expected report")]
    ReportMismatch,
}
