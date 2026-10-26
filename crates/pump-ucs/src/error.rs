use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum UcsError {
    #[error("UCS input exceeds the supported {0} limit")]
    Limit(&'static str),
    #[error("UCS input must be ASCII or UTF-8 ASCII with an optional BOM")]
    Encoding,
    #[error("UCS malformed at line {line}: {message}")]
    Malformed { line: usize, message: &'static str },
    #[error("UCS unsupported value at line {line}: {message}")]
    Unsupported { line: usize, message: &'static str },
    #[error("UCS timing arithmetic overflow")]
    Overflow,
    #[error("UCS chart is invalid: {0}")]
    Chart(String),
    #[error("UCS music is invalid: {0}")]
    Music(String),
    #[error("UCS chart and music grids differ")]
    GridMismatch,
    #[error("UCS chart cannot be represented in the supported profile: {0}")]
    Unrepresentable(&'static str),
}

impl UcsError {
    pub(crate) const fn malformed(line: usize, message: &'static str) -> Self {
        Self::Malformed { line, message }
    }

    pub(crate) const fn unsupported(line: usize, message: &'static str) -> Self {
        Self::Unsupported { line, message }
    }
}
