use std::collections::BTreeMap;

use pump_chart::{Chart, Music};

use super::model::{FootPose, PosePair, crossed, movement};
use super::timing::{at_least, elapsed};
use crate::{EvalContract, EvalError, MetricVector};

#[cfg(test)]
mod tests;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct State {
    pub(super) poses: PosePair,
    pub(super) owners: [u8; 10],
    pub(super) hold_ends: [u64; 10],
    pub(super) last_moves: [u64; 2],
}

#[derive(Clone, Copy)]
pub(super) struct Event {
    pub(super) tick: u64,
    starts: u16,
    hold_starts: u16,
    hold_ends: [u64; 10],
}

pub(super) struct Transition {
    pub(super) state: State,
    pub(super) contact_poses: PosePair,
    pub(super) metrics: MetricVector,
    pub(super) tick: u64,
}

pub(super) struct TransitionBatch {
    pub(super) routes: Vec<Transition>,
    pub(super) work: u64,
}

pub(super) fn transitions(
    state: &State,
    event: Event,
    music: &Music,
    contract: &EvalContract,
) -> Result<TransitionBatch, EvalError> {
    let mut released = state.clone();
    let blocked_until = [blocked_until(state, 1), blocked_until(state, 2)];
    let mut released_feet = [false; 2];
    for panel in 0_u8..10 {
        let index = usize::from(panel);
        if released.owners[index] != 0 && released.hold_ends[index] == event.tick {
            released_feet[usize::from(released.owners[index] - 1)] = true;
            released.owners[index] = 0;
            released.hold_ends[index] = 0;
        }
    }
    for (index, did_release) in released_feet.into_iter().enumerate() {
        if did_release {
            released.last_moves[index] = event.tick;
        }
    }
    let held_left = owner_mask(&released, 1);
    let held_right = owner_mask(&released, 2);
    let mut output = Vec::new();
    let mut work = 0_u64;
    let mut left_new = event.starts;
    loop {
        work = work.checked_add(1).ok_or(EvalError::ArithmeticOverflow)?;
        let right_new = event.starts ^ left_new;
        let left_mask = held_left | left_new;
        let right_mask = held_right | right_new;
        if let (Some(left), Some(right)) = (
            target_pose(released.poses.left, left_mask),
            target_pose(released.poses.right, right_mask),
        ) {
            let poses = PosePair { left, right };
            let contact_poses = PosePair {
                left: if left_mask == 0 { FootPose::Off } else { left },
                right: if right_mask == 0 {
                    FootPose::Off
                } else {
                    right
                },
            };
            if reachable(&released, poses, blocked_until, event.tick, music, contract)? {
                let mut candidate = released.clone();
                candidate.poses = poses;
                update_move_ticks(&mut candidate, left_new, right_new, event.tick);
                assign_holds(&mut candidate, left_new, right_new, event)?;
                output.push(Transition {
                    state: candidate,
                    contact_poses,
                    metrics: MetricVector {
                        movement: movement(state.poses.left, left)
                            .checked_add(movement(state.poses.right, right))
                            .ok_or(EvalError::ArithmeticOverflow)?,
                        brackets: u64::from(contact_poses.left.is_bracket())
                            + u64::from(contact_poses.right.is_bracket()),
                        crossover: u64::from(crossed(contact_poses)),
                        hold_occupancy: u64::from(
                            (held_left | held_right | event.hold_starts).count_ones(),
                        ),
                    },
                    tick: event.tick,
                });
            }
        }
        if left_new == 0 {
            break;
        }
        left_new = (left_new - 1) & event.starts;
    }
    Ok(TransitionBatch {
        routes: output,
        work,
    })
}

fn reachable(
    state: &State,
    target: PosePair,
    blocked_until: [u64; 2],
    tick: u64,
    music: &Music,
    contract: &EvalContract,
) -> Result<bool, EvalError> {
    for (index, (from, to)) in [
        (state.poses.left, target.left),
        (state.poses.right, target.right),
    ]
    .into_iter()
    .enumerate()
    {
        if from == to || matches!(from, FootPose::Off) {
            continue;
        }
        let start = state.last_moves[index].max(blocked_until[index]);
        if start > tick {
            return Ok(false);
        }
        let travel = movement(from, to)
            .checked_mul(contract.foot_model.micros_per_panel_unit)
            .ok_or(EvalError::ArithmeticOverflow)?;
        let setup = if to.is_bracket() {
            contract.foot_model.bracket_setup_micros
        } else {
            0
        };
        let required = travel
            .checked_add(setup)
            .ok_or(EvalError::ArithmeticOverflow)?;
        if !at_least(elapsed(music, start, tick)?, required)? {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn events(chart: &Chart) -> Result<Vec<Event>, EvalError> {
    let mut by_tick = BTreeMap::<u64, Event>::new();
    for note in &chart.notes {
        let entry = by_tick.entry(note.tick).or_insert(Event {
            tick: note.tick,
            starts: 0,
            hold_starts: 0,
            hold_ends: [0; 10],
        });
        entry.starts |= note.panel_mask;
        if note.hold_ticks > 0 {
            entry.hold_starts |= note.panel_mask;
            let end = note
                .tick
                .checked_add(note.hold_ticks)
                .ok_or(EvalError::ArithmeticOverflow)?;
            for panel in 0_u8..10 {
                let bit = 1_u16 << panel;
                if note.panel_mask & bit != 0 {
                    entry.hold_ends[usize::from(panel)] = end;
                }
            }
            by_tick.entry(end).or_insert(Event {
                tick: end,
                starts: 0,
                hold_starts: 0,
                hold_ends: [0; 10],
            });
        }
    }
    Ok(by_tick.into_values().collect())
}

fn target_pose(previous: FootPose, required: u16) -> Option<FootPose> {
    if required == 0 {
        Some(previous)
    } else {
        FootPose::from_mask(required)
    }
}

fn owner_mask(state: &State, owner: u8) -> u16 {
    state
        .owners
        .iter()
        .enumerate()
        .fold(0_u16, |mask, (panel, value)| {
            if *value == owner {
                mask | (1_u16 << panel)
            } else {
                mask
            }
        })
}

fn blocked_until(state: &State, owner: u8) -> u64 {
    state
        .owners
        .iter()
        .zip(state.hold_ends)
        .filter_map(|(value, end)| (*value == owner).then_some(end))
        .max()
        .unwrap_or(0)
}

fn update_move_ticks(state: &mut State, left_new: u16, right_new: u16, tick: u64) {
    if left_new != 0 {
        state.last_moves[0] = tick;
    }
    if right_new != 0 {
        state.last_moves[1] = tick;
    }
}

fn assign_holds(
    state: &mut State,
    left_new: u16,
    right_new: u16,
    event: Event,
) -> Result<(), EvalError> {
    for panel in 0_u8..10 {
        let bit = 1_u16 << panel;
        if event.hold_starts & bit != 0 {
            state.owners[usize::from(panel)] = if left_new & bit != 0 {
                1
            } else if right_new & bit != 0 {
                2
            } else {
                return Err(EvalError::InvalidChart("hold was not assigned".into()));
            };
            state.hold_ends[usize::from(panel)] = event.hold_ends[usize::from(panel)];
        }
    }
    Ok(())
}
