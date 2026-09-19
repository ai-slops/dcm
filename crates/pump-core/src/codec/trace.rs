use crate::codec::io::{Reader, length, put_string, put_u16, put_u32};
use crate::model::{Command, CommandTrace, PlanError};
use crate::{FORMAT_VERSION, PANEL_MASK};

const MAGIC: &[u8; 4] = b"PCTR";

pub fn encode_trace(trace: &CommandTrace) -> Result<Vec<u8>, PlanError> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    put_u16(&mut out, trace.version);
    put_string(&mut out, &trace.plan_digest)?;
    put_string(&mut out, &trace.seed_digest)?;
    put_u32(&mut out, trace.duration);
    put_u32(&mut out, length(trace.commands.len())?);
    for command in &trace.commands {
        put_u32(&mut out, command.tick);
        put_u32(&mut out, command.duration);
        put_u16(&mut out, command.panel_mask);
        put_string(&mut out, &command.decision_id)?;
        put_string(&mut out, &command.provenance)?;
    }
    Ok(out)
}

pub fn decode_trace(bytes: &[u8]) -> Result<CommandTrace, PlanError> {
    let mut reader = Reader::new(bytes, 64 * 1024 * 1024);
    if reader.take(4)? != MAGIC {
        return Err(PlanError::InvalidFormat("trace magic"));
    }
    let version = reader.u16()?;
    if version != FORMAT_VERSION {
        return Err(PlanError::UnsupportedVersion(version));
    }
    let plan_digest = reader.string()?;
    let seed_digest = reader.string()?;
    let duration = reader.u32()?;
    let count = reader.u32()?;
    if count == 0 || count > 10_000 {
        return Err(PlanError::TraceBudget { limit: 10_000 });
    }
    let mut commands = Vec::with_capacity(usize::try_from(count).map_err(|_| PlanError::Overflow)?);
    for _ in 0..count {
        commands.push(Command {
            tick: reader.u32()?,
            duration: reader.u32()?,
            panel_mask: reader.u16()?,
            decision_id: reader.string()?,
            provenance: reader.string()?,
        });
    }
    if reader.remaining() != 0 {
        return Err(PlanError::InvalidFormat("trailing trace bytes"));
    }
    let trace = CommandTrace {
        version,
        plan_digest,
        seed_digest,
        duration,
        commands,
    };
    validate_trace(&trace)?;
    Ok(trace)
}

fn validate_trace(trace: &CommandTrace) -> Result<(), PlanError> {
    if !digest(&trace.plan_digest) || !digest(&trace.seed_digest) {
        return Err(PlanError::NonCanonical("trace digest"));
    }
    if trace.duration == 0 {
        return Err(PlanError::InvalidDuration);
    }
    let mut panel_ends = [0_u32; 10];
    let mut previous: Option<(u32, u16, &str)> = None;
    for command in &trace.commands {
        if command.panel_mask == 0 || command.panel_mask & !PANEL_MASK != 0 {
            return Err(PlanError::InvalidPanelMask(command.panel_mask));
        }
        if command.duration == 0 {
            return Err(PlanError::InvalidDuration);
        }
        if command.decision_id.is_empty() {
            return Err(PlanError::DecisionId(String::new()));
        }
        let end = command
            .tick
            .checked_add(command.duration)
            .ok_or(PlanError::Overflow)?;
        if end > trace.duration {
            return Err(PlanError::NonCanonical("command bounds"));
        }
        let key = (
            command.tick,
            command.panel_mask,
            command.decision_id.as_str(),
        );
        if previous.is_some_and(|prior| prior > key) {
            return Err(PlanError::NonCanonical("command order"));
        }
        for panel in 0_u8..10 {
            if command.panel_mask & (1_u16 << panel) != 0 {
                let slot = panel_ends
                    .get_mut(usize::from(panel))
                    .ok_or(PlanError::Overflow)?;
                if command.tick < *slot {
                    return Err(PlanError::PanelCollision {
                        mask: 1_u16 << panel,
                    });
                }
                *slot = end;
            }
        }
        previous = Some(key);
    }
    Ok(())
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}
