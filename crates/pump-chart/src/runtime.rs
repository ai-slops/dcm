use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

use crate::{
    Candidate, CandidateId, Chart, Fraction, GeneratedChart, GenerationRequest, HistoryPolicy,
    Music, RuntimeError, RuntimeProgram, WeightedChart, normalize_chart, validate_music,
};

const CANDIDATE_DOMAIN: &[u8] = b"pump-chart-v2-candidate\0";
const SAMPLE_DOMAIN: &[u8] = b"pump-chart-v2-sample\0";

pub fn candidate_id(chart: &Chart) -> Result<CandidateId, crate::ValidationError> {
    let chart = normalize_chart(chart)?;
    let mut hasher = Sha256::new();
    hasher.update(CANDIDATE_DOMAIN);
    hasher.update(chart.ticks_per_beat.to_le_bytes());
    hasher.update(chart.span_ticks.to_le_bytes());
    hasher.update(
        u64::try_from(chart.notes.len())
            .map_err(|_| crate::ValidationError::Overflow)?
            .to_le_bytes(),
    );
    for note in &chart.notes {
        hasher.update(note.tick.to_le_bytes());
        hasher.update(note.panel_mask.to_le_bytes());
        hasher.update(note.hold_ticks.to_le_bytes());
    }
    Ok(CandidateId(hasher.finalize().into()))
}

pub fn build_runtime(
    music: Music,
    weighted_charts: &[WeightedChart],
    history_policy: HistoryPolicy,
) -> Result<RuntimeProgram, RuntimeError> {
    validate_music(&music)?;
    if history_policy.recent_window > history_policy.max_request_history {
        return Err(RuntimeError::HistoryTooLong);
    }
    if history_policy.max_request_history > crate::MAX_REQUEST_HISTORY {
        return Err(RuntimeError::HistoryTooLong);
    }
    let mut merged = BTreeMap::<CandidateId, WeightedChart>::new();
    for weighted in weighted_charts {
        if weighted.prior_mass.numerator() == 0 {
            return Err(RuntimeError::ZeroWeight);
        }
        let chart = normalize_chart(&weighted.chart)?;
        if chart.ticks_per_beat != music.ticks_per_beat || chart.span_ticks != music.duration_ticks
        {
            return Err(RuntimeError::Validation(
                crate::ValidationError::InvalidGrid,
            ));
        }
        let id = candidate_id(&chart)?;
        match merged.get_mut(&id) {
            Some(existing) if existing.chart == chart => {
                existing.prior_mass = existing.prior_mass.checked_add(weighted.prior_mass)?;
            }
            Some(_) => return Err(RuntimeError::DigestCollision),
            None => {
                merged.insert(
                    id,
                    WeightedChart {
                        chart,
                        prior_mass: weighted.prior_mass,
                    },
                );
            }
        }
    }
    if merged.is_empty() {
        return Err(RuntimeError::NoCandidates);
    }
    if merged.len() > usize::try_from(crate::MAX_DERIVATIONS).map_err(|_| RuntimeError::Overflow)? {
        return Err(RuntimeError::Overflow);
    }
    let common_denominator = merged.values().try_fold(1_u128, |common, weighted| {
        let denominator = weighted.prior_mass.denominator();
        let divisor = crate::fraction::gcd(common, denominator);
        common
            .checked_mul(denominator / divisor)
            .ok_or(RuntimeError::Overflow)
    })?;
    let mut raw = Vec::with_capacity(merged.len());
    let mut weight_divisor = 0_u128;
    let mut original_mass = Fraction::ZERO;
    for (id, weighted) in merged {
        let weight = weighted
            .prior_mass
            .numerator()
            .checked_mul(common_denominator / weighted.prior_mass.denominator())
            .ok_or(RuntimeError::Overflow)?;
        weight_divisor = crate::fraction::gcd(weight_divisor, weight);
        original_mass = original_mass.checked_add(weighted.prior_mass)?;
        raw.push((id, weighted, weight));
    }
    let candidates = raw
        .into_iter()
        .map(|(id, weighted, weight)| Candidate {
            id,
            chart: weighted.chart,
            weight: weight / weight_divisor,
            original_prior_mass: weighted.prior_mass,
        })
        .collect();
    Ok(RuntimeProgram {
        music,
        candidates,
        history_policy,
        original_mass,
    })
}

pub fn generate(
    program: &RuntimeProgram,
    request: &GenerationRequest,
) -> Result<GeneratedChart, RuntimeError> {
    if request.history.len()
        > usize::try_from(program.history_policy.max_request_history)
            .map_err(|_| RuntimeError::HistoryTooLong)?
    {
        return Err(RuntimeError::HistoryTooLong);
    }
    let program_bytes = crate::encode_runtime_program(program)?;
    let request_bytes = crate::encode_generation_request(request)?;
    let program_sha256: [u8; 32] = Sha256::digest(&program_bytes).into();
    let request_sha256: [u8; 32] = Sha256::digest(&request_bytes).into();
    let recent_count = usize::try_from(program.history_policy.recent_window)
        .map_err(|_| RuntimeError::HistoryTooLong)?;
    let excluded: BTreeSet<_> = request
        .history
        .iter()
        .rev()
        .take(recent_count)
        .copied()
        .collect();
    let mut eligible: Vec<&Candidate> = program
        .candidates
        .iter()
        .filter(|candidate| !excluded.contains(&candidate.id))
        .collect();
    let allow_repeat_fallback = eligible.is_empty();
    if allow_repeat_fallback {
        eligible = program.candidates.iter().collect();
    }
    let base_weight = sum_weights(program.candidates.iter())?;
    let eligible_weight = sum_weights(eligible.iter().copied())?;
    let sample = sample_below(program_sha256, request_sha256, eligible_weight);
    let mut boundary = 0_u128;
    let mut selected = eligible[0];
    for candidate in eligible {
        boundary = boundary
            .checked_add(candidate.weight)
            .ok_or(RuntimeError::Overflow)?;
        if sample < boundary {
            selected = candidate;
            break;
        }
    }
    Ok(GeneratedChart {
        candidate_id: selected.id,
        chart: selected.chart.clone(),
        program_sha256,
        request_sha256,
        base_ratio: Fraction::new(selected.weight, base_weight)?,
        history_conditioned_ratio: Fraction::new(selected.weight, eligible_weight)?,
        eligible_weight,
        allow_repeat_fallback,
    })
}

fn sum_weights<'a>(
    mut candidates: impl Iterator<Item = &'a Candidate>,
) -> Result<u128, RuntimeError> {
    candidates.try_fold(0_u128, |sum, candidate| {
        if candidate.weight == 0 {
            return Err(RuntimeError::ZeroWeight);
        }
        sum.checked_add(candidate.weight)
            .ok_or(RuntimeError::Overflow)
    })
}

fn sample_below(program_hash: [u8; 32], request_hash: [u8; 32], upper: u128) -> u128 {
    let threshold = upper.wrapping_neg() % upper;
    let mut counter = 0_u64;
    loop {
        let mut hasher = Sha256::new();
        hasher.update(SAMPLE_DOMAIN);
        hasher.update(program_hash);
        hasher.update(request_hash);
        hasher.update(counter.to_le_bytes());
        let digest: [u8; 32] = hasher.finalize().into();
        let mut sample_bytes = [0_u8; 16];
        sample_bytes.copy_from_slice(&digest[..16]);
        let sample = u128::from_le_bytes(sample_bytes);
        if sample >= threshold {
            return sample % upper;
        }
        counter = counter.wrapping_add(1);
    }
}
