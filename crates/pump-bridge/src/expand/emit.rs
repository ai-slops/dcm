use pump_chart::Note;
use pump_core::{Node, NodeId, ScopeKind};

use super::{Action, Interpreter, State, Visit, string_bytes};
use crate::BridgeError;

impl Interpreter<'_> {
    pub(super) fn emit(&mut self, state: &mut State, visit: Visit) -> Result<bool, BridgeError> {
        let index = usize::try_from(visit.node.0).map_err(|_| BridgeError::ArithmeticOverflow)?;
        let entry = self
            .source
            .nodes
            .get(index)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        match &entry.node {
            Node::Tap { mask, .. } => {
                self.add_events(1)?;
                if state.notes.len()
                    >= usize::try_from(self.limits.max_trace_notes)
                        .map_err(|_| BridgeError::ArithmeticOverflow)?
                {
                    return Err(BridgeError::LimitExceeded("trace notes"));
                }
                state.notes.push(Note {
                    tick: visit.start,
                    panel_mask: if visit.mirrored { mirror(*mask) } else { *mask },
                    hold_ticks: 0,
                });
                Ok(false)
            }
            Node::Sequence { children } => self.schedule_children(state, children, visit, true),
            Node::Parallel { children } => self.schedule_children(state, children, visit, false),
            Node::Repeat { child, times } => {
                self.charge_work(u64::from(*times))?;
                self.charge_work(
                    u64::try_from(entry.decision_id.len())
                        .map_err(|_| BridgeError::ArithmeticOverflow)?,
                )?;
                let child_duration = u64::from(self.duration(*child)?);
                state.pending.push(Action::RepeatStep {
                    child: *child,
                    next: 0,
                    count: *times,
                    start: visit.start,
                    duration: child_duration,
                    mirrored: visit.mirrored,
                    occurrence: visit.occurrence,
                    decision_id: entry.decision_id.clone(),
                    depth: visit.depth + 1,
                });
                Ok(false)
            }
            Node::Choice { alternatives, .. } => self.choose(state, alternatives, visit),
            Node::Scope {
                kind,
                occurrence_key,
                child,
            } => {
                let mut nested = visit.occurrence;
                let scope_work = scope_name(*kind)
                    .len()
                    .checked_add(occurrence_key.len())
                    .and_then(|value| value.checked_add(1))
                    .ok_or(BridgeError::ArithmeticOverflow)?;
                self.charge_work(
                    u64::try_from(scope_work).map_err(|_| BridgeError::ArithmeticOverflow)?,
                )?;
                nested.push(format!("{}:{occurrence_key}", scope_name(*kind)));
                state.pending.push(Action::Emit {
                    node: *child,
                    start: visit.start,
                    mirrored: visit.mirrored,
                    occurrence: nested,
                    depth: visit.depth + 1,
                });
                Ok(false)
            }
            Node::Mirror { child } => {
                state.pending.push(Action::Emit {
                    node: *child,
                    start: visit.start,
                    mirrored: !visit.mirrored,
                    occurrence: visit.occurrence,
                    depth: visit.depth + 1,
                });
                Ok(false)
            }
            Node::Relation { left, right, .. } => {
                self.charge_work(
                    u64::try_from(string_bytes(&visit.occurrence)?)
                        .map_err(|_| BridgeError::ArithmeticOverflow)?,
                )?;
                let next = visit
                    .start
                    .checked_add(u64::from(self.duration(*left)?))
                    .ok_or(BridgeError::ArithmeticOverflow)?;
                state.pending.push(Action::Emit {
                    node: *right,
                    start: next,
                    mirrored: visit.mirrored,
                    occurrence: visit.occurrence.clone(),
                    depth: visit.depth + 1,
                });
                state.pending.push(Action::Emit {
                    node: *left,
                    start: visit.start,
                    mirrored: visit.mirrored,
                    occurrence: visit.occurrence,
                    depth: visit.depth + 1,
                });
                Ok(false)
            }
        }
    }

    fn schedule_children(
        &mut self,
        state: &mut State,
        children: &[NodeId],
        visit: Visit,
        sequence: bool,
    ) -> Result<bool, BridgeError> {
        let context_work = string_bytes(&visit.occurrence)?
            .checked_add(visit.occurrence.len())
            .and_then(|value| value.checked_add(1))
            .and_then(|value| value.checked_mul(children.len()))
            .ok_or(BridgeError::ArithmeticOverflow)?;
        self.charge_work(
            u64::try_from(context_work).map_err(|_| BridgeError::ArithmeticOverflow)?,
        )?;
        let mut starts = Vec::with_capacity(children.len());
        let mut cursor = visit.start;
        for child in children {
            starts.push(cursor);
            if sequence {
                cursor = cursor
                    .checked_add(u64::from(self.duration(*child)?))
                    .ok_or(BridgeError::ArithmeticOverflow)?;
            }
        }
        for (child, child_start) in children.iter().zip(starts).rev() {
            state.pending.push(Action::Emit {
                node: *child,
                start: child_start,
                mirrored: visit.mirrored,
                occurrence: visit.occurrence.clone(),
                depth: visit.depth + 1,
            });
        }
        Ok(false)
    }
}

const fn mirror(mask: u16) -> u16 {
    let mut source = mask;
    let mut target = 0_u16;
    let mut index = 0_u8;
    while index < 10 {
        if source & 1 == 1 {
            target |= 1 << (9 - index);
        }
        source >>= 1;
        index += 1;
    }
    target
}

const fn scope_name(kind: ScopeKind) -> &'static str {
    match kind {
        ScopeKind::Run => "run",
        ScopeKind::Section => "section",
        ScopeKind::Phrase => "phrase",
    }
}
