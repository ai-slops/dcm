use pump_chart::Fraction;

use super::{Action, Binding, ChoiceKey, Interpreter, State, Visit, string_bytes};
use crate::BridgeError;

impl Interpreter<'_> {
    pub(super) fn choose(
        &mut self,
        state: &mut State,
        alternatives: &[pump_core::WeightedNode],
        visit: Visit,
    ) -> Result<bool, BridgeError> {
        let decision_bytes = self.decision_id(visit.node)?.len();
        self.charge_work(
            u64::try_from(decision_bytes).map_err(|_| BridgeError::ArithmeticOverflow)?,
        )?;
        let key = ChoiceKey {
            decision_id: self.decision_id(visit.node)?.to_owned(),
            occurrence: visit.occurrence,
        };
        if let Some(binding) = state.environment.get(&key) {
            if binding.node != visit.node {
                return Err(BridgeError::ChoiceIdentityConflict);
            }
            let selected = alternatives
                .get(binding.branch)
                .ok_or(BridgeError::ChoiceIdentityConflict)?;
            state.pending.push(Action::Emit {
                node: selected.node,
                start: visit.start,
                mirrored: visit.mirrored,
                occurrence: key.occurrence,
                depth: visit.depth + 1,
            });
            return Ok(false);
        }
        let total = alternatives.iter().try_fold(0_u128, |sum, item| {
            sum.checked_add(u128::from(item.weight))
                .ok_or(BridgeError::ArithmeticOverflow)
        })?;
        let resulting = self
            .active
            .len()
            .checked_add(self.finished.len())
            .and_then(|count| count.checked_add(alternatives.len()))
            .ok_or(BridgeError::ArithmeticOverflow)?;
        if resulting
            > usize::try_from(self.limits.max_derivations)
                .map_err(|_| BridgeError::ArithmeticOverflow)?
        {
            return Err(BridgeError::LimitExceeded("derivations"));
        }
        let occurrence_bytes = string_bytes(&key.occurrence)?;
        let occurrence_units = occurrence_bytes
            .checked_add(key.occurrence.len())
            .and_then(|count| count.checked_mul(2))
            .ok_or(BridgeError::ArithmeticOverflow)?;
        let clone_units = state_clone_units(state)?
            .checked_add(key.decision_id.len())
            .and_then(|count| count.checked_add(occurrence_units))
            .ok_or(BridgeError::ArithmeticOverflow)?;
        self.charge_work(
            u64::try_from(
                clone_units
                    .checked_mul(alternatives.len())
                    .ok_or(BridgeError::ArithmeticOverflow)?,
            )
            .map_err(|_| BridgeError::ArithmeticOverflow)?,
        )?;
        self.add_events(
            state
                .notes
                .len()
                .checked_mul(alternatives.len().saturating_sub(1))
                .ok_or(BridgeError::ArithmeticOverflow)?,
        )?;
        for (branch, alternative) in alternatives.iter().enumerate() {
            let mut child = state.clone();
            child.mass = child
                .mass
                .checked_mul(Fraction::new(u128::from(alternative.weight), total)?)?;
            child.environment.insert(
                key.clone(),
                Binding {
                    node: visit.node,
                    branch,
                },
            );
            child.pending.push(Action::Emit {
                node: alternative.node,
                start: visit.start,
                mirrored: visit.mirrored,
                occurrence: key.occurrence.clone(),
                depth: visit.depth + 1,
            });
            self.active.push(child);
        }
        Ok(true)
    }
}

fn state_clone_units(state: &State) -> Result<usize, BridgeError> {
    let mut units = state
        .notes
        .len()
        .checked_add(state.pending.len())
        .and_then(|value| value.checked_add(state.environment.len()))
        .ok_or(BridgeError::ArithmeticOverflow)?;
    for action in &state.pending {
        let (occurrence, name_bytes) = match action {
            Action::Emit { occurrence, .. } => (occurrence, 0),
            Action::RepeatStep {
                occurrence,
                decision_id,
                ..
            } => (occurrence, decision_id.len()),
        };
        units = units
            .checked_add(string_bytes(occurrence)?)
            .and_then(|value| value.checked_add(occurrence.len()))
            .and_then(|value| value.checked_add(name_bytes))
            .ok_or(BridgeError::ArithmeticOverflow)?;
    }
    for key in state.environment.keys() {
        let context_bytes = string_bytes(&key.occurrence)?;
        units = units
            .checked_add(key.decision_id.len())
            .and_then(|value| value.checked_add(key.occurrence.len()))
            .and_then(|value| value.checked_add(context_bytes))
            .ok_or(BridgeError::ArithmeticOverflow)?;
    }
    Ok(units)
}
