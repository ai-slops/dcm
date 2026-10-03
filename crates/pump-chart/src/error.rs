use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FractionError {
    #[error("fraction denominator is zero")]
    ZeroDenominator,
    #[error("fraction arithmetic overflow")]
    Overflow,
    #[error("division by zero")]
    DivisionByZero,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ValidationError {
    #[error("invalid panel mask {0:#06x}")]
    InvalidPanelMask(u16),
    #[error("chart note lies outside its span")]
    NoteOutsideSpan,
    #[error("chart span must be positive")]
    InvalidSpan,
    #[error("a hold must have positive duration")]
    ZeroHold,
    #[error("a rest must have positive duration")]
    ZeroRest,
    #[error("a repeat must have a positive count")]
    ZeroRepeat,
    #[error("sequence and parallel nodes must have children")]
    EmptyComposite,
    #[error("arena child references must point backward")]
    ForwardReference,
    #[error("model limit exceeded: {0}")]
    LimitExceeded(&'static str),
    #[error("semantic keys must be nonempty")]
    EmptySemanticKey,
    #[error("node semantic keys must be unique")]
    DuplicateSemanticKey,
    #[error("duplicate or overlapping panel demand")]
    OverlappingDemand,
    #[error("notes are not in canonical order")]
    NonCanonicalNotes,
    #[error("ticks per beat must be positive")]
    InvalidGrid,
    #[error("invalid tempo map")]
    InvalidTempo,
    #[error("reference accents are invalid")]
    InvalidAccents,
    #[error("arithmetic overflow")]
    Overflow,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum EnumerateError {
    #[error("plan is invalid: {0}")]
    InvalidPlan(String),
    #[error("enumeration limit exceeded: {0}")]
    LimitExceeded(&'static str),
    #[error("fraction error: {0}")]
    Fraction(#[from] FractionError),
    #[error("chart is invalid: {0}")]
    Chart(#[from] ValidationError),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RuntimeError {
    #[error("runtime has no candidates")]
    NoCandidates,
    #[error("runtime candidate weight is zero")]
    ZeroWeight,
    #[error("request history exceeds the configured bound")]
    HistoryTooLong,
    #[error("arithmetic overflow")]
    Overflow,
    #[error("candidate digest collision")]
    DigestCollision,
    #[error("fraction error: {0}")]
    Fraction(#[from] FractionError),
    #[error("invalid model: {0}")]
    Validation(#[from] ValidationError),
    #[error("codec error: {0}")]
    Codec(#[from] CodecError),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TimingError {
    #[error("tick is outside the music duration")]
    TickOutsideMusic,
    #[error("invalid music: {0}")]
    InvalidMusic(#[from] ValidationError),
    #[error("fraction error: {0}")]
    Fraction(#[from] FractionError),
    #[error("signed time overflow")]
    Overflow,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CodecError {
    #[error("wrong artifact magic or version")]
    WrongFormat,
    #[error("truncated input")]
    Truncated,
    #[error("trailing bytes")]
    TrailingBytes,
    #[error("invalid tag {0}")]
    InvalidTag(u8),
    #[error("decoded length exceeds limits")]
    LengthLimit,
    #[error("invalid UTF-8")]
    InvalidUtf8,
    #[error("invalid model: {0}")]
    Validation(#[from] ValidationError),
    #[error("invalid fraction: {0}")]
    Fraction(#[from] FractionError),
    #[error("fraction encoding is not reduced")]
    NonCanonicalFraction,
}
