use std::collections::BTreeSet;

use crate::intent_detect::{Detection, take_work};
use crate::{CreditPolicy, EvalContract, EvalError, Requiredness};

struct ExclusiveUnit {
    rule_index: usize,
    notes: Vec<u32>,
}

struct AllocationSearch<'a> {
    contract: &'a EvalContract,
    units: &'a [ExclusiveUnit],
    best: Vec<Vec<Vec<u32>>>,
    best_score: AllocationScore,
    work: &'a mut u64,
}

#[derive(Clone, Copy)]
enum SearchPhase {
    Enter,
    AfterSkip,
    AfterTake,
}

#[derive(Clone, Copy)]
struct SearchFrame {
    index: usize,
    phase: SearchPhase,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
struct AllocationScore {
    satisfied_required: u32,
    required_progress: u64,
    total_credit: u64,
}

pub(super) fn allocate(
    contract: &EvalContract,
    detections: &[Detection],
    work: &mut u64,
) -> Result<Vec<Vec<Vec<u32>>>, EvalError> {
    let exclusive_count = contract
        .intents
        .iter()
        .zip(detections)
        .filter(|(rule, _)| matches!(rule.credit_policy, CreditPolicy::Exclusive))
        .try_fold(0_usize, |count, (_, detection)| {
            count
                .checked_add(detection.units.len())
                .ok_or(EvalError::ArithmeticOverflow)
        })?;
    let minimum_work = u64::try_from(exclusive_count)
        .map_err(|_| EvalError::ArithmeticOverflow)?
        .checked_add(1)
        .ok_or(EvalError::ArithmeticOverflow)?;
    if work
        .checked_add(minimum_work)
        .ok_or(EvalError::ArithmeticOverflow)?
        > contract.budgets.max_matching_work
    {
        return Err(EvalError::MatchingBudget {
            limit: contract.budgets.max_matching_work,
        });
    }
    let mut allocations = vec![Vec::new(); contract.intents.len()];
    let mut exclusive = Vec::with_capacity(exclusive_count);
    for (rule_index, (rule, detection)) in contract.intents.iter().zip(detections).enumerate() {
        match rule.credit_policy {
            CreditPolicy::Shared => allocations[rule_index] = detection.units.clone(),
            CreditPolicy::Exclusive => exclusive.extend(
                detection
                    .units
                    .iter()
                    .cloned()
                    .map(|notes| ExclusiveUnit { rule_index, notes }),
            ),
        }
    }
    let best_score = allocation_score(contract, &allocations)?;
    let mut search = AllocationSearch {
        contract,
        units: &exclusive,
        best: allocations.clone(),
        best_score,
        work,
    };
    search.run(&mut BTreeSet::new(), &mut allocations)?;
    Ok(search.best)
}

impl AllocationSearch<'_> {
    fn run(
        &mut self,
        used: &mut BTreeSet<u32>,
        current: &mut [Vec<Vec<u32>>],
    ) -> Result<(), EvalError> {
        let mut stack = vec![SearchFrame {
            index: 0,
            phase: SearchPhase::Enter,
        }];
        while let Some(frame) = stack.pop() {
            match frame.phase {
                SearchPhase::Enter => {
                    take_work(self.work, self.contract.budgets.max_matching_work)?;
                    if frame.index == self.units.len() {
                        let score = allocation_score(self.contract, current)?;
                        if score > self.best_score {
                            self.best_score = score;
                            self.best.clone_from_slice(current);
                        }
                    } else {
                        stack.push(SearchFrame {
                            index: frame.index,
                            phase: SearchPhase::AfterSkip,
                        });
                        stack.push(SearchFrame {
                            index: frame.index + 1,
                            phase: SearchPhase::Enter,
                        });
                    }
                }
                SearchPhase::AfterSkip => {
                    let unit = &self.units[frame.index];
                    if unit.notes.iter().all(|note| !used.contains(note)) {
                        used.extend(unit.notes.iter().copied());
                        current[unit.rule_index].push(unit.notes.clone());
                        stack.push(SearchFrame {
                            index: frame.index,
                            phase: SearchPhase::AfterTake,
                        });
                        stack.push(SearchFrame {
                            index: frame.index + 1,
                            phase: SearchPhase::Enter,
                        });
                    }
                }
                SearchPhase::AfterTake => {
                    let unit = &self.units[frame.index];
                    current[unit.rule_index].pop();
                    for note in &unit.notes {
                        used.remove(note);
                    }
                }
            }
        }
        Ok(())
    }
}

fn allocation_score(
    contract: &EvalContract,
    allocations: &[Vec<Vec<u32>>],
) -> Result<AllocationScore, EvalError> {
    contract.intents.iter().zip(allocations).try_fold(
        AllocationScore::default(),
        |mut score, (rule, units)| {
            let count = u64::try_from(units.len()).map_err(|_| EvalError::ArithmeticOverflow)?;
            let credit = count
                .checked_mul(u64::from(rule.weight))
                .ok_or(EvalError::ArithmeticOverflow)?;
            score.total_credit = score
                .total_credit
                .checked_add(credit)
                .ok_or(EvalError::ArithmeticOverflow)?;
            if matches!(rule.requiredness, Requiredness::Required) {
                score.required_progress = score
                    .required_progress
                    .checked_add(credit.min(u64::from(rule.threshold)))
                    .ok_or(EvalError::ArithmeticOverflow)?;
                if credit >= u64::from(rule.threshold) {
                    score.satisfied_required = score
                        .satisfied_required
                        .checked_add(1)
                        .ok_or(EvalError::ArithmeticOverflow)?;
                }
            }
            Ok(score)
        },
    )
}
