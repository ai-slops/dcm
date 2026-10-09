use pump_chart::{Chart, Fraction, WeightedChart};
use pump_core::NodeId;

use super::{Action, Expansion, Interpreter, State, Visit, string_bytes};
use crate::BridgeError;

impl Interpreter<'_> {
    pub(super) fn run(&mut self) -> Result<Expansion, BridgeError> {
        while let Some(mut state) = self.active.pop() {
            let mut forked = false;
            while let Some(action) = state.pending.pop() {
                if matches!(action, Action::Emit { .. }) {
                    self.charge_work(1)?;
                }
                forked = self.apply(&mut state, action)?;
                if forked {
                    break;
                }
            }
            if !forked {
                let chart = pump_chart::normalize_chart(&Chart {
                    ticks_per_beat: self.music.ticks_per_beat,
                    span_ticks: self.music.duration_ticks,
                    notes: state.notes,
                })
                .map_err(BridgeError::InvalidChart)?;
                self.finished.push(WeightedChart {
                    chart,
                    prior_mass: state.mass,
                });
            }
        }
        let total_mass = self
            .finished
            .iter()
            .try_fold(Fraction::ZERO, |sum, item| sum.checked_add(item.prior_mass))?;
        if total_mass != Fraction::ONE {
            return Err(BridgeError::ArithmeticOverflow);
        }
        Ok(Expansion {
            charts: std::mem::take(&mut self.finished),
            total_mass,
            work: self.work,
        })
    }

    fn apply(&mut self, state: &mut State, action: Action) -> Result<bool, BridgeError> {
        match action {
            Action::Emit {
                node,
                start,
                mirrored,
                occurrence,
                depth,
            } => {
                if depth > self.limits.max_depth {
                    return Err(BridgeError::LimitExceeded("depth"));
                }
                self.emit(
                    state,
                    Visit {
                        node,
                        start,
                        mirrored,
                        occurrence,
                        depth,
                    },
                )
            }
            Action::RepeatStep {
                child,
                next,
                count,
                start,
                duration,
                mirrored,
                occurrence,
                decision_id,
                depth,
            } => {
                if next >= count {
                    return Ok(false);
                }
                let context_work = string_bytes(&occurrence)?
                    .checked_add(decision_id.len())
                    .and_then(|value| value.checked_add(11))
                    .ok_or(BridgeError::ArithmeticOverflow)?;
                self.charge_work(
                    u64::try_from(context_work).map_err(|_| BridgeError::ArithmeticOverflow)?,
                )?;
                let offset = duration
                    .checked_mul(u64::from(next))
                    .ok_or(BridgeError::ArithmeticOverflow)?;
                let mut nested = occurrence.clone();
                nested.push(format!("{decision_id}#{next}"));
                state.pending.push(Action::RepeatStep {
                    child,
                    next: next + 1,
                    count,
                    start,
                    duration,
                    mirrored,
                    occurrence,
                    decision_id,
                    depth,
                });
                state.pending.push(Action::Emit {
                    node: child,
                    start: start
                        .checked_add(offset)
                        .ok_or(BridgeError::ArithmeticOverflow)?,
                    mirrored,
                    occurrence: nested,
                    depth,
                });
                Ok(false)
            }
        }
    }

    pub(super) fn duration(&self, id: NodeId) -> Result<u32, BridgeError> {
        Ok(self
            .source
            .nodes
            .get(usize::try_from(id.0).map_err(|_| BridgeError::ArithmeticOverflow)?)
            .ok_or(BridgeError::ArithmeticOverflow)?
            .duration)
    }

    pub(super) fn decision_id(&self, id: NodeId) -> Result<&str, BridgeError> {
        Ok(&self
            .source
            .nodes
            .get(usize::try_from(id.0).map_err(|_| BridgeError::ArithmeticOverflow)?)
            .ok_or(BridgeError::ArithmeticOverflow)?
            .decision_id)
    }

    pub(super) fn charge_work(&mut self, count: u64) -> Result<(), BridgeError> {
        self.work = self
            .work
            .checked_add(count)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        if self.work > self.limits.max_work {
            Err(BridgeError::LimitExceeded("work"))
        } else {
            Ok(())
        }
    }

    pub(super) fn add_events(&mut self, count: usize) -> Result<(), BridgeError> {
        self.events = self
            .events
            .checked_add(u64::try_from(count).map_err(|_| BridgeError::ArithmeticOverflow)?)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        if self.events > self.limits.max_total_events {
            Err(BridgeError::LimitExceeded("events"))
        } else {
            Ok(())
        }
    }
}
