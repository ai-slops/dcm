use crate::decode::Decoder;
use crate::{CandidateId, CodecError, GeneratedChart, GenerationRequest};

impl Decoder<'_> {
    pub(crate) fn request(&mut self) -> Result<GenerationRequest, CodecError> {
        let seed = self.array()?;
        let count = self.count(u64::from(crate::MAX_REQUEST_HISTORY))?;
        let mut history = Vec::with_capacity(count);
        for _ in 0..count {
            history.push(CandidateId(self.array()?));
        }
        Ok(GenerationRequest { seed, history })
    }

    pub(crate) fn generated(&mut self) -> Result<GeneratedChart, CodecError> {
        let candidate_id = CandidateId(self.array()?);
        let chart = self.chart()?;
        let program_sha256 = self.array()?;
        let request_sha256 = self.array()?;
        let base_ratio = self.fraction()?;
        let history_conditioned_ratio = self.fraction()?;
        let eligible_weight = self.u128()?;
        let allow_repeat_fallback = match self.u8()? {
            0 => false,
            1 => true,
            tag => return Err(CodecError::InvalidTag(tag)),
        };
        Ok(GeneratedChart {
            candidate_id,
            chart,
            program_sha256,
            request_sha256,
            base_ratio,
            history_conditioned_ratio,
            eligible_weight,
            allow_repeat_fallback,
        })
    }
}
