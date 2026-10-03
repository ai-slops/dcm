use std::collections::BTreeSet;

use pump_chart::{Chart, Music};

use crate::intent_detect::{Detection, detect};
use crate::{
    EvalContract, EvalError, IntentEvidence, IntentKind, IntentReport, IntentRule, Rejection,
    RejectionKind, Requiredness, ScoreVector,
};

mod allocate;
#[cfg(test)]
mod tests;

use allocate::allocate;

pub(crate) fn evaluate(
    chart: &Chart,
    music: &Music,
    contract: &EvalContract,
) -> Result<IntentReport, EvalError> {
    let mut work = 0_u64;
    let detections = contract
        .intents
        .iter()
        .map(|rule| {
            detect(
                chart,
                music,
                &rule.kind,
                &mut work,
                contract.budgets.max_matching_work,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let allocations = allocate(contract, &detections, &mut work)?;
    build_report(contract, detections, allocations)
}

fn build_report(
    contract: &EvalContract,
    detections: Vec<Detection>,
    allocations: Vec<Vec<Vec<u32>>>,
) -> Result<IntentReport, EvalError> {
    let mut scores = ScoreVector::default();
    let mut evidence = Vec::with_capacity(contract.intents.len());
    let mut rejections = Vec::new();
    for ((rule, detection), units) in contract.intents.iter().zip(detections).zip(allocations) {
        let score = u32::try_from(units.len()).map_err(|_| EvalError::ArithmeticOverflow)?;
        let credited = score
            .checked_mul(rule.weight)
            .ok_or(EvalError::ArithmeticOverflow)?;
        add_score(&mut scores, rule, credited)?;
        if matches!(rule.requiredness, Requiredness::Required) && credited < rule.threshold {
            rejections.push(Rejection {
                kind: RejectionKind::IntentThreshold,
                rule_id: Some(rule.id.clone()),
                observed: Some(u64::from(credited)),
                required: Some(u64::from(rule.threshold)),
                frame: None,
                explanation: "required note-derived evidence credit was not met".into(),
            });
        }
        evidence.push(IntentEvidence {
            intent_id: rule.id.clone(),
            score,
            credited,
            supporting_note_indices: units
                .into_iter()
                .flatten()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            explanation: detection.explanation.into(),
        });
    }
    Ok(IntentReport {
        scores,
        evidence,
        rejections,
    })
}

fn add_score(scores: &mut ScoreVector, rule: &IntentRule, credit: u32) -> Result<(), EvalError> {
    let kind = match rule.kind {
        IntentKind::ReferenceAccents { .. } => &mut scores.reference_accents,
        IntentKind::NegativeSpace { .. } => &mut scores.negative_space,
        IntentKind::RelationalMotif { .. } => &mut scores.relational_motifs,
    };
    *kind = kind
        .checked_add(credit)
        .ok_or(EvalError::ArithmeticOverflow)?;
    let requirement = match rule.requiredness {
        Requiredness::Required => &mut scores.required_credit,
        Requiredness::Optional => &mut scores.optional_credit,
    };
    *requirement = requirement
        .checked_add(credit)
        .ok_or(EvalError::ArithmeticOverflow)?;
    Ok(())
}
