use std::collections::BTreeMap;

use super::model::{Contact, FramePath, RouteWindow};
use super::transition::{State, Transition};
use crate::{EvalContract, EvalError, ExecutionReport, MetricVector};

#[derive(Clone)]
pub(super) struct Bounds {
    pub(super) minimum: MetricVector,
    pub(super) maximum: MetricVector,
    pub(super) local_minimum: Vec<u64>,
    pub(super) local_maximum: Vec<u64>,
    pub(super) best_cost: u64,
    pub(super) worst_cost: u64,
    pub(super) best_metrics: MetricVector,
    pub(super) best_contacts: Vec<Contact>,
    pub(super) path_count: u8,
}

pub(super) fn advance(
    bounds: &Bounds,
    transition: &Transition,
    contact: Contact,
    windows: &[(u32, u64, u64)],
    contract: &EvalContract,
) -> Result<Bounds, EvalError> {
    let minimum = add_metrics(bounds.minimum, transition.metrics)?;
    let maximum = add_metrics(bounds.maximum, transition.metrics)?;
    let step_cost = scalar(transition.metrics, contract)?;
    let best_cost = bounds
        .best_cost
        .checked_add(step_cost)
        .ok_or(EvalError::ArithmeticOverflow)?;
    let worst_cost = bounds
        .worst_cost
        .checked_add(step_cost)
        .ok_or(EvalError::ArithmeticOverflow)?;
    let best_metrics = add_metrics(bounds.best_metrics, transition.metrics)?;
    let mut best_contacts = bounds.best_contacts.clone();
    best_contacts.push(contact);
    let mut local_minimum = bounds.local_minimum.clone();
    let mut local_maximum = bounds.local_maximum.clone();
    for (index, (_, start, end)) in windows.iter().enumerate() {
        if transition.tick >= *start && transition.tick < *end {
            local_minimum[index] = local_minimum[index]
                .checked_add(step_cost)
                .ok_or(EvalError::ArithmeticOverflow)?;
            local_maximum[index] = local_maximum[index]
                .checked_add(step_cost)
                .ok_or(EvalError::ArithmeticOverflow)?;
        }
    }
    Ok(Bounds {
        minimum,
        maximum,
        local_minimum,
        local_maximum,
        best_cost,
        worst_cost,
        best_metrics,
        best_contacts,
        path_count: bounds.path_count,
    })
}

pub(super) fn merge(states: &mut BTreeMap<State, Bounds>, state: State, incoming: Bounds) {
    match states.get_mut(&state) {
        None => {
            states.insert(state, incoming);
        }
        Some(current) => {
            current.minimum = min_metrics(current.minimum, incoming.minimum);
            current.maximum = max_metrics(current.maximum, incoming.maximum);
            for (value, incoming_value) in current
                .local_minimum
                .iter_mut()
                .zip(&incoming.local_minimum)
            {
                *value = (*value).min(*incoming_value);
            }
            for (value, incoming_value) in current
                .local_maximum
                .iter_mut()
                .zip(&incoming.local_maximum)
            {
                *value = (*value).max(*incoming_value);
            }
            current.path_count = current
                .path_count
                .saturating_add(incoming.path_count)
                .min(2);
            current.worst_cost = current.worst_cost.max(incoming.worst_cost);
            if incoming.best_cost < current.best_cost {
                current.best_cost = incoming.best_cost;
                current.best_metrics = incoming.best_metrics;
                current.best_contacts = incoming.best_contacts;
            }
        }
    }
}

pub(super) fn finish(
    contract: &EvalContract,
    states: BTreeMap<State, Bounds>,
    contacts: Vec<Vec<Contact>>,
    windows: &[(u32, u64, u64)],
) -> Result<ExecutionReport, EvalError> {
    let mut all = states.into_values();
    let Some(first) = all.next() else {
        return Err(EvalError::InvalidChart("empty execution state".into()));
    };
    let mut aggregate = first;
    for next in all {
        aggregate.minimum = min_metrics(aggregate.minimum, next.minimum);
        aggregate.maximum = max_metrics(aggregate.maximum, next.maximum);
        for (value, next_value) in aggregate.local_minimum.iter_mut().zip(next.local_minimum) {
            *value = (*value).min(next_value);
        }
        for (value, next_value) in aggregate.local_maximum.iter_mut().zip(next.local_maximum) {
            *value = (*value).max(next_value);
        }
        aggregate.path_count = aggregate.path_count.saturating_add(next.path_count).min(2);
        aggregate.worst_cost = aggregate.worst_cost.max(next.worst_cost);
        if next.best_cost < aggregate.best_cost {
            aggregate.best_cost = next.best_cost;
            aggregate.best_metrics = next.best_metrics;
            aggregate.best_contacts = next.best_contacts;
        }
    }
    let route_windows = windows
        .iter()
        .enumerate()
        .map(|(index, (rule_index, start, end))| RouteWindow {
            rule_index: *rule_index,
            start_tick: *start,
            end_tick: *end,
            minimum_movement: aggregate.local_minimum[index],
            maximum_movement: aggregate.local_maximum[index],
        })
        .collect();
    Ok(ExecutionReport {
        model_version: contract.foot_model.version,
        feasible: true,
        best_path: Some(FramePath {
            contacts: aggregate.best_contacts,
            objectives: aggregate.best_metrics,
        }),
        alternative_path_exists: aggregate.path_count > 1,
        min_objectives: aggregate.minimum,
        max_objectives: aggregate.maximum,
        min_total_objective: aggregate.best_cost,
        max_total_objective: aggregate.worst_cost,
        earliest_infeasible_frame: None,
        feasible_contacts_by_frame: contacts,
        route_windows,
    })
}

pub(super) fn infeasible(
    contract: &EvalContract,
    contacts: Vec<Vec<Contact>>,
    frame: u32,
) -> ExecutionReport {
    ExecutionReport {
        model_version: contract.foot_model.version,
        feasible: false,
        best_path: None,
        alternative_path_exists: false,
        min_objectives: MetricVector::default(),
        max_objectives: MetricVector::default(),
        min_total_objective: 0,
        max_total_objective: 0,
        earliest_infeasible_frame: Some(frame),
        feasible_contacts_by_frame: contacts,
        route_windows: Vec::new(),
    }
}

fn add_metrics(left: MetricVector, right: MetricVector) -> Result<MetricVector, EvalError> {
    Ok(MetricVector {
        movement: left
            .movement
            .checked_add(right.movement)
            .ok_or(EvalError::ArithmeticOverflow)?,
        brackets: left
            .brackets
            .checked_add(right.brackets)
            .ok_or(EvalError::ArithmeticOverflow)?,
        crossover: left
            .crossover
            .checked_add(right.crossover)
            .ok_or(EvalError::ArithmeticOverflow)?,
        hold_occupancy: left
            .hold_occupancy
            .checked_add(right.hold_occupancy)
            .ok_or(EvalError::ArithmeticOverflow)?,
    })
}

fn min_metrics(left: MetricVector, right: MetricVector) -> MetricVector {
    MetricVector {
        movement: left.movement.min(right.movement),
        brackets: left.brackets.min(right.brackets),
        crossover: left.crossover.min(right.crossover),
        hold_occupancy: left.hold_occupancy.min(right.hold_occupancy),
    }
}
fn max_metrics(left: MetricVector, right: MetricVector) -> MetricVector {
    MetricVector {
        movement: left.movement.max(right.movement),
        brackets: left.brackets.max(right.brackets),
        crossover: left.crossover.max(right.crossover),
        hold_occupancy: left.hold_occupancy.max(right.hold_occupancy),
    }
}

fn scalar(metrics: MetricVector, contract: &EvalContract) -> Result<u64, EvalError> {
    metrics
        .movement
        .checked_add(
            metrics
                .brackets
                .checked_mul(u64::from(contract.foot_model.bracket_penalty))
                .ok_or(EvalError::ArithmeticOverflow)?,
        )
        .and_then(|value| {
            value.checked_add(
                metrics
                    .crossover
                    .checked_mul(u64::from(contract.foot_model.crossover_penalty))?,
            )
        })
        .ok_or(EvalError::ArithmeticOverflow)
}
