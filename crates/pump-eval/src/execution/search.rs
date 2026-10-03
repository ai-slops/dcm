use std::collections::{BTreeMap, BTreeSet};

use pump_chart::{Chart, Music};

use super::bounds::{Bounds, advance, finish, infeasible, merge};
use super::model::{Contact, FootPose, PosePair};
use super::transition::{State, events, transitions};
use crate::{EvalContract, EvalError, ExecutionReport, MetricVector};

pub(crate) fn evaluate(
    chart: &Chart,
    music: &Music,
    contract: &EvalContract,
) -> Result<ExecutionReport, EvalError> {
    if chart.notes.len()
        > usize::try_from(contract.budgets.max_notes).map_err(|_| EvalError::ArithmeticOverflow)?
    {
        return Err(EvalError::NoteBudget {
            limit: contract.budgets.max_notes,
        });
    }
    let events = events(chart)?;
    if events.len()
        > usize::try_from(contract.budgets.max_frames).map_err(|_| EvalError::ArithmeticOverflow)?
    {
        return Err(EvalError::FrameBudget {
            limit: contract.budgets.max_frames,
        });
    }
    let windows = windows(chart, contract)?;
    let initial = State {
        poses: PosePair {
            left: FootPose::Off,
            right: FootPose::Off,
        },
        owners: [0; 10],
        hold_ends: [0; 10],
        last_moves: [0; 2],
    };
    let mut states = BTreeMap::from([(
        initial,
        Bounds {
            minimum: MetricVector::default(),
            maximum: MetricVector::default(),
            local_minimum: vec![0; windows.len()],
            local_maximum: vec![0; windows.len()],
            best_cost: 0,
            worst_cost: 0,
            best_metrics: MetricVector::default(),
            best_contacts: Vec::new(),
            path_count: 1,
        },
    )]);
    let mut contacts_by_frame = Vec::with_capacity(events.len());
    let mut work = 0_u64;
    for (frame_index, event) in events.iter().enumerate() {
        let frame = u32::try_from(frame_index).map_err(|_| EvalError::ArithmeticOverflow)?;
        let mut next = BTreeMap::new();
        let mut frame_contacts = BTreeSet::new();
        for (state, bounds) in &states {
            let batch = transitions(state, *event, music, contract)?;
            work = work
                .checked_add(batch.work)
                .ok_or(EvalError::ArithmeticOverflow)?;
            check_work(work, contract)?;
            for candidate in batch.routes {
                let clone_work = bounds
                    .best_contacts
                    .len()
                    .checked_add(bounds.local_minimum.len())
                    .and_then(|value| value.checked_add(bounds.local_maximum.len()))
                    .and_then(|value| value.checked_add(1))
                    .ok_or(EvalError::ArithmeticOverflow)?;
                let clone_work =
                    u64::try_from(clone_work).map_err(|_| EvalError::ArithmeticOverflow)?;
                work = work
                    .checked_add(
                        u64::try_from(windows.len()).map_err(|_| EvalError::ArithmeticOverflow)?,
                    )
                    .and_then(|value| value.checked_add(clone_work))
                    .ok_or(EvalError::ArithmeticOverflow)?;
                check_work(work, contract)?;
                let contact = Contact {
                    frame,
                    tick: event.tick,
                    poses: candidate.contact_poses,
                };
                frame_contacts.insert(contact);
                let updated = advance(bounds, &candidate, contact, &windows, contract)?;
                merge(&mut next, candidate.state, updated);
            }
        }
        if next.is_empty() {
            return Ok(infeasible(contract, contacts_by_frame, frame));
        }
        contacts_by_frame.push(frame_contacts.into_iter().collect());
        states = next;
    }
    finish(contract, states, contacts_by_frame, &windows)
}

fn check_work(work: u64, contract: &EvalContract) -> Result<(), EvalError> {
    if work > contract.budgets.max_dp_work {
        Err(EvalError::DpBudget {
            limit: contract.budgets.max_dp_work,
        })
    } else {
        Ok(())
    }
}

fn windows(chart: &Chart, contract: &EvalContract) -> Result<Vec<(u32, u64, u64)>, EvalError> {
    let starts: BTreeSet<u64> = chart.notes.iter().map(|note| note.tick).collect();
    let count = starts
        .len()
        .checked_mul(contract.difficulty.local_windows.len())
        .ok_or(EvalError::ArithmeticOverflow)?;
    if u64::try_from(count).map_err(|_| EvalError::ArithmeticOverflow)?
        > contract.budgets.max_dp_work
    {
        return Err(EvalError::DpBudget {
            limit: contract.budgets.max_dp_work,
        });
    }
    let mut output = Vec::new();
    for (index, rule) in contract.difficulty.local_windows.iter().enumerate() {
        let rule_index = u32::try_from(index).map_err(|_| EvalError::ArithmeticOverflow)?;
        for start in &starts {
            output.push((
                rule_index,
                *start,
                start
                    .checked_add(rule.width_ticks)
                    .ok_or(EvalError::ArithmeticOverflow)?,
            ));
        }
    }
    Ok(output)
}
