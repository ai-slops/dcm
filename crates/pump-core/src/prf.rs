use sha2::{Digest, Sha256};

use crate::model::PlanError;

pub fn sample_weighted(
    seed: &[u8],
    decision_id: &str,
    occurrence: &[&str],
    weights: &[u32],
) -> Result<usize, PlanError> {
    if seed.len() != 32 {
        return Err(PlanError::InvalidSeed);
    }
    if weights.is_empty() {
        return Err(PlanError::EmptyChildren);
    }
    let total = weights.iter().try_fold(0_u64, |sum, weight| {
        if *weight == 0 {
            return Err(PlanError::InvalidWeight);
        }
        sum.checked_add(u64::from(*weight))
            .ok_or(PlanError::Overflow)
    })?;
    let zone = u64::MAX - (u64::MAX % total);
    let mut counter = 0_u64;
    loop {
        let mut hash = Sha256::new();
        hash.update(b"pump-prf-v1\0");
        hash.update(seed);
        update_field(&mut hash, decision_id.as_bytes())?;
        for part in occurrence {
            update_field(&mut hash, part.as_bytes())?;
        }
        hash.update(counter.to_le_bytes());
        let digest = hash.finalize();
        let mut bytes = [0_u8; 8];
        bytes.copy_from_slice(&digest[..8]);
        let candidate = u64::from_le_bytes(bytes);
        if candidate < zone {
            let selected = candidate % total;
            let mut cursor = 0_u64;
            for (index, weight) in weights.iter().enumerate() {
                cursor = cursor
                    .checked_add(u64::from(*weight))
                    .ok_or(PlanError::Overflow)?;
                if selected < cursor {
                    return Ok(index);
                }
            }
            return Err(PlanError::Overflow);
        }
        counter = counter.checked_add(1).ok_or(PlanError::Overflow)?;
    }
}

fn update_field(hash: &mut Sha256, bytes: &[u8]) -> Result<(), PlanError> {
    let length = u32::try_from(bytes.len()).map_err(|_| PlanError::Overflow)?;
    hash.update(length.to_le_bytes());
    hash.update(bytes);
    Ok(())
}
