use crate::{
    Candidate, CandidateId, Chart, CodecError, Fraction, HistoryPolicy, Limits, Music, Node, Note,
    Plan, RuntimeProgram, TempoSegment, WeightedNode,
};

pub(crate) struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
    pub(crate) limits: &'a Limits,
}

impl<'a> Decoder<'a> {
    pub(crate) fn new(
        bytes: &'a [u8],
        limits: &'a Limits,
        magic: [u8; 4],
    ) -> Result<Self, CodecError> {
        crate::validate_limits(limits)?;
        if u64::try_from(bytes.len()).map_err(|_| CodecError::LengthLimit)? > limits.max_codec_bytes
        {
            return Err(CodecError::LengthLimit);
        }
        let mut decoder = Self {
            bytes,
            offset: 0,
            limits,
        };
        if decoder.take(4)? != magic || decoder.u16()? != crate::FORMAT_VERSION {
            return Err(CodecError::WrongFormat);
        }
        Ok(decoder)
    }
    pub(crate) fn finish(self) -> Result<(), CodecError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(CodecError::TrailingBytes)
        }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], CodecError> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(CodecError::LengthLimit)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(CodecError::Truncated)?;
        self.offset = end;
        Ok(value)
    }
    pub(crate) fn array<const N: usize>(&mut self) -> Result<[u8; N], CodecError> {
        self.take(N)?.try_into().map_err(|_| CodecError::Truncated)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, CodecError> {
        Ok(self.array::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, CodecError> {
        Ok(u16::from_le_bytes(self.array()?))
    }
    fn u32(&mut self) -> Result<u32, CodecError> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, CodecError> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    pub(crate) fn u128(&mut self) -> Result<u128, CodecError> {
        Ok(u128::from_le_bytes(self.array()?))
    }
    fn i64(&mut self) -> Result<i64, CodecError> {
        Ok(i64::from_le_bytes(self.array()?))
    }
    pub(crate) fn count(&mut self, maximum: u64) -> Result<usize, CodecError> {
        let value = u64::from(self.u32()?);
        if value > maximum {
            return Err(CodecError::LengthLimit);
        }
        usize::try_from(value).map_err(|_| CodecError::LengthLimit)
    }
    fn string(&mut self) -> Result<String, CodecError> {
        let count = self.count(u64::from(self.limits.max_string_bytes))?;
        String::from_utf8(self.take(count)?.to_vec()).map_err(|_| CodecError::InvalidUtf8)
    }
    pub(crate) fn fraction(&mut self) -> Result<Fraction, CodecError> {
        let numerator = self.u128()?;
        let denominator = self.u128()?;
        let fraction = Fraction::new(numerator, denominator)?;
        if fraction.numerator() != numerator || fraction.denominator() != denominator {
            return Err(CodecError::NonCanonicalFraction);
        }
        Ok(fraction)
    }
    pub(crate) fn music(&mut self) -> Result<Music, CodecError> {
        let duration_ticks = self.u64()?;
        let ticks_per_beat = self.u32()?;
        let offset_micros = self.i64()?;
        let count = self.count(u64::from(self.limits.max_nodes))?;
        let mut tempo = Vec::with_capacity(count);
        for _ in 0..count {
            tempo.push(TempoSegment {
                start_tick: self.u64()?,
                micros_per_beat: self.fraction()?,
            });
        }
        let audio_sha256 = self.array()?;
        let count = self.count(self.limits.max_total_events)?;
        let mut reference_accents = Vec::with_capacity(count);
        for _ in 0..count {
            reference_accents.push(self.u64()?);
        }
        Ok(Music {
            duration_ticks,
            ticks_per_beat,
            offset_micros,
            tempo,
            audio_sha256,
            reference_accents,
        })
    }
    fn note(&mut self) -> Result<Note, CodecError> {
        Ok(Note {
            tick: self.u64()?,
            panel_mask: self.u16()?,
            hold_ticks: self.u64()?,
        })
    }
    pub(crate) fn chart(&mut self) -> Result<Chart, CodecError> {
        let ticks_per_beat = self.u32()?;
        let span_ticks = self.u64()?;
        let count = self.count(u64::from(self.limits.max_trace_notes))?;
        let mut notes = Vec::with_capacity(count);
        for _ in 0..count {
            notes.push(self.note()?);
        }
        Ok(Chart {
            ticks_per_beat,
            span_ticks,
            notes,
        })
    }
    fn ids(&mut self) -> Result<Vec<u32>, CodecError> {
        let count = self.count(self.limits.max_edges)?;
        let mut ids = Vec::with_capacity(count);
        for _ in 0..count {
            ids.push(self.u32()?);
        }
        Ok(ids)
    }
    fn weighted_node(&mut self) -> Result<WeightedNode, CodecError> {
        Ok(WeightedNode {
            node: self.u32()?,
            weight: self.u128()?,
            key: self.string()?,
        })
    }
    pub(crate) fn node(&mut self) -> Result<Node, CodecError> {
        match self.u8()? {
            0 => Ok(Node::Tap {
                panel_mask: self.u16()?,
                key: self.string()?,
            }),
            1 => Ok(Node::Hold {
                panel_mask: self.u16()?,
                duration_ticks: self.u64()?,
                key: self.string()?,
            }),
            2 => Ok(Node::Rest {
                duration_ticks: self.u64()?,
                key: self.string()?,
            }),
            3 => Ok(Node::Sequence {
                children: self.ids()?,
                key: self.string()?,
            }),
            4 => Ok(Node::Parallel {
                children: self.ids()?,
                key: self.string()?,
            }),
            5 => Ok(Node::Repeat {
                child: self.u32()?,
                count: self.u32()?,
                key: self.string()?,
            }),
            6 => {
                let count = self.count(self.limits.max_edges)?;
                let mut branches = Vec::with_capacity(count);
                for _ in 0..count {
                    branches.push(self.weighted_node()?);
                }
                Ok(Node::Choice {
                    branches,
                    key: self.string()?,
                })
            }
            7 => Ok(Node::Mirror {
                child: self.u32()?,
                key: self.string()?,
            }),
            tag => Err(CodecError::InvalidTag(tag)),
        }
    }
    pub(crate) fn plan(&mut self) -> Result<Plan, CodecError> {
        let music = self.music()?;
        let count = self.count(u64::from(self.limits.max_nodes))?;
        let mut nodes = Vec::with_capacity(count);
        for _ in 0..count {
            nodes.push(self.node()?);
        }
        let count = self.count(u64::from(self.limits.max_nodes))?;
        let mut provenance = Vec::with_capacity(count);
        for _ in 0..count {
            provenance.push(self.string()?);
        }
        Ok(Plan {
            music,
            nodes,
            provenance,
            root: self.u32()?,
        })
    }
    fn candidate(&mut self) -> Result<Candidate, CodecError> {
        Ok(Candidate {
            id: CandidateId(self.array()?),
            chart: self.chart()?,
            weight: self.u128()?,
            original_prior_mass: self.fraction()?,
        })
    }
    pub(crate) fn runtime(&mut self) -> Result<RuntimeProgram, CodecError> {
        let music = self.music()?;
        let count = self.count(u64::from(self.limits.max_derivations))?;
        let mut candidates = Vec::with_capacity(count);
        for _ in 0..count {
            candidates.push(self.candidate()?);
        }
        let history_policy = HistoryPolicy {
            recent_window: self.u32()?,
            max_request_history: self.u32()?,
        };
        Ok(RuntimeProgram {
            music,
            candidates,
            history_policy,
            original_mass: self.fraction()?,
        })
    }
}
