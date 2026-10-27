use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};

pub fn weighted_index(request_sha256: &[u8; 32], slot: u64, weights: &[u64]) -> Result<usize> {
    let total = weights.iter().try_fold(0_u64, |sum, weight| {
        sum.checked_add(*weight)
            .context("choice weight sum overflow")
    })?;
    let threshold = u64::MAX - (u64::MAX % total);
    for attempt in 0..=u32::MAX {
        let digest = Sha256::new()
            .chain_update(b"pump-rule-slot-v1\0")
            .chain_update(request_sha256)
            .chain_update(slot.to_le_bytes())
            .chain_update(attempt.to_le_bytes())
            .finalize();
        let bytes: [u8; 8] = digest[..8]
            .try_into()
            .map_err(|_| anyhow::anyhow!("SHA-256 sample width is invalid"))?;
        let sample = u64::from_le_bytes(bytes);
        if sample >= threshold {
            continue;
        }
        let mut ticket = sample % total;
        for (index, weight) in weights.iter().enumerate() {
            if ticket < *weight {
                return Ok(index);
            }
            ticket -= *weight;
        }
        bail!("weighted sample did not select a choice");
    }
    bail!("unbiased weighted sampling exhausted its counter domain")
}
