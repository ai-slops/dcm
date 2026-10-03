use crate::{Limits, ValidationError};

pub fn validate_limits(limits: &Limits) -> Result<(), ValidationError> {
    let within_hard_caps = limits.max_nodes <= crate::MAX_NODES
        && limits.max_depth <= crate::MAX_DEPTH
        && limits.max_edges <= crate::MAX_EDGES
        && limits.max_derivations <= crate::MAX_DERIVATIONS
        && limits.max_trace_notes <= crate::MAX_TRACE_NOTES
        && limits.max_total_events <= crate::MAX_TOTAL_EVENTS
        && limits.max_work <= crate::MAX_ENUMERATION_WORK
        && limits.max_string_bytes <= crate::MAX_STRING_BYTES
        && limits.max_codec_bytes <= crate::MAX_CODEC_BYTES;
    if within_hard_caps {
        Ok(())
    } else {
        Err(ValidationError::LimitExceeded("configured hard cap"))
    }
}
