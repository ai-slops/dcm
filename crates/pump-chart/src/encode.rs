use crate::{
    Candidate, Chart, Fraction, GeneratedChart, GenerationRequest, Music, Node, Note, Plan,
    RuntimeProgram, TempoSegment, WeightedNode,
};

pub(crate) struct Encoder {
    bytes: Vec<u8>,
    max_bytes: usize,
}

impl Encoder {
    pub(crate) fn new(magic: [u8; 4], max_bytes: u64) -> Result<Self, crate::CodecError> {
        let mut encoder = Self {
            bytes: Vec::new(),
            max_bytes: usize::try_from(max_bytes).map_err(|_| crate::CodecError::LengthLimit)?,
        };
        encoder.fixed(&magic)?;
        encoder.u16(crate::FORMAT_VERSION)?;
        Ok(encoder)
    }

    pub(crate) fn finish(self) -> Vec<u8> {
        self.bytes
    }
    fn append(&mut self, value: &[u8]) -> Result<(), crate::CodecError> {
        let length = self
            .bytes
            .len()
            .checked_add(value.len())
            .ok_or(crate::CodecError::LengthLimit)?;
        if length > self.max_bytes {
            return Err(crate::CodecError::LengthLimit);
        }
        self.bytes
            .try_reserve(value.len())
            .map_err(|_| crate::CodecError::LengthLimit)?;
        self.bytes.extend_from_slice(value);
        Ok(())
    }
    pub(crate) fn u8(&mut self, value: u8) -> Result<(), crate::CodecError> {
        self.append(&[value])
    }
    pub(crate) fn u16(&mut self, value: u16) -> Result<(), crate::CodecError> {
        self.append(&value.to_le_bytes())
    }
    pub(crate) fn u32(&mut self, value: u32) -> Result<(), crate::CodecError> {
        self.append(&value.to_le_bytes())
    }
    pub(crate) fn u64(&mut self, value: u64) -> Result<(), crate::CodecError> {
        self.append(&value.to_le_bytes())
    }
    pub(crate) fn u128(&mut self, value: u128) -> Result<(), crate::CodecError> {
        self.append(&value.to_le_bytes())
    }
    pub(crate) fn i64(&mut self, value: i64) -> Result<(), crate::CodecError> {
        self.append(&value.to_le_bytes())
    }
    pub(crate) fn fixed(&mut self, value: &[u8]) -> Result<(), crate::CodecError> {
        self.append(value)
    }
    pub(crate) fn len(&mut self, value: usize) -> Result<(), crate::CodecError> {
        self.u32(u32::try_from(value).map_err(|_| crate::CodecError::LengthLimit)?)
    }
    pub(crate) fn string(&mut self, value: &str) -> Result<(), crate::CodecError> {
        self.len(value.len())?;
        self.fixed(value.as_bytes())
    }
    pub(crate) fn fraction(&mut self, value: Fraction) -> Result<(), crate::CodecError> {
        self.u128(value.numerator())?;
        self.u128(value.denominator())
    }
    pub(crate) fn music(&mut self, music: &Music) -> Result<(), crate::CodecError> {
        self.u64(music.duration_ticks)?;
        self.u32(music.ticks_per_beat)?;
        self.i64(music.offset_micros)?;
        self.len(music.tempo.len())?;
        for segment in &music.tempo {
            self.tempo(segment)?;
        }
        self.fixed(&music.audio_sha256)?;
        self.len(music.reference_accents.len())?;
        for tick in &music.reference_accents {
            self.u64(*tick)?;
        }
        Ok(())
    }
    fn tempo(&mut self, segment: &TempoSegment) -> Result<(), crate::CodecError> {
        self.u64(segment.start_tick)?;
        self.fraction(segment.micros_per_beat)
    }
    pub(crate) fn note(&mut self, note: &Note) -> Result<(), crate::CodecError> {
        self.u64(note.tick)?;
        self.u16(note.panel_mask)?;
        self.u64(note.hold_ticks)
    }
    pub(crate) fn chart(&mut self, chart: &Chart) -> Result<(), crate::CodecError> {
        self.u32(chart.ticks_per_beat)?;
        self.u64(chart.span_ticks)?;
        self.len(chart.notes.len())?;
        for note in &chart.notes {
            self.note(note)?;
        }
        Ok(())
    }
    fn weighted_node(&mut self, branch: &WeightedNode) -> Result<(), crate::CodecError> {
        self.u32(branch.node)?;
        self.u128(branch.weight)?;
        self.string(&branch.key)
    }
    fn ids(&mut self, ids: &[u32]) -> Result<(), crate::CodecError> {
        self.len(ids.len())?;
        for id in ids {
            self.u32(*id)?;
        }
        Ok(())
    }
    pub(crate) fn node(&mut self, node: &Node) -> Result<(), crate::CodecError> {
        match node {
            Node::Tap { panel_mask, key } => {
                self.u8(0)?;
                self.u16(*panel_mask)?;
                self.string(key)?;
            }
            Node::Hold {
                panel_mask,
                duration_ticks,
                key,
            } => {
                self.u8(1)?;
                self.u16(*panel_mask)?;
                self.u64(*duration_ticks)?;
                self.string(key)?;
            }
            Node::Rest {
                duration_ticks,
                key,
            } => {
                self.u8(2)?;
                self.u64(*duration_ticks)?;
                self.string(key)?;
            }
            Node::Sequence { children, key } => {
                self.u8(3)?;
                self.ids(children)?;
                self.string(key)?;
            }
            Node::Parallel { children, key } => {
                self.u8(4)?;
                self.ids(children)?;
                self.string(key)?;
            }
            Node::Repeat { child, count, key } => {
                self.u8(5)?;
                self.u32(*child)?;
                self.u32(*count)?;
                self.string(key)?;
            }
            Node::Choice { branches, key } => {
                self.u8(6)?;
                self.len(branches.len())?;
                for branch in branches {
                    self.weighted_node(branch)?;
                }
                self.string(key)?;
            }
            Node::Mirror { child, key } => {
                self.u8(7)?;
                self.u32(*child)?;
                self.string(key)?;
            }
        }
        Ok(())
    }
    pub(crate) fn plan(&mut self, plan: &Plan) -> Result<(), crate::CodecError> {
        self.music(&plan.music)?;
        self.len(plan.nodes.len())?;
        for node in &plan.nodes {
            self.node(node)?;
        }
        self.len(plan.provenance.len())?;
        for provenance in &plan.provenance {
            self.string(provenance)?;
        }
        self.u32(plan.root)
    }
    fn candidate(&mut self, candidate: &Candidate) -> Result<(), crate::CodecError> {
        self.fixed(&candidate.id.0)?;
        self.chart(&candidate.chart)?;
        self.u128(candidate.weight)?;
        self.fraction(candidate.original_prior_mass)
    }
    pub(crate) fn runtime(&mut self, program: &RuntimeProgram) -> Result<(), crate::CodecError> {
        self.music(&program.music)?;
        self.len(program.candidates.len())?;
        for candidate in &program.candidates {
            self.candidate(candidate)?;
        }
        self.u32(program.history_policy.recent_window)?;
        self.u32(program.history_policy.max_request_history)?;
        self.fraction(program.original_mass)
    }
    pub(crate) fn request(&mut self, request: &GenerationRequest) -> Result<(), crate::CodecError> {
        self.fixed(&request.seed)?;
        self.len(request.history.len())?;
        for id in &request.history {
            self.fixed(&id.0)?;
        }
        Ok(())
    }
    pub(crate) fn generated(
        &mut self,
        generated: &GeneratedChart,
    ) -> Result<(), crate::CodecError> {
        self.fixed(&generated.candidate_id.0)?;
        self.chart(&generated.chart)?;
        self.fixed(&generated.program_sha256)?;
        self.fixed(&generated.request_sha256)?;
        self.fraction(generated.base_ratio)?;
        self.fraction(generated.history_conditioned_ratio)?;
        self.u128(generated.eligible_weight)?;
        self.u8(u8::from(generated.allow_repeat_fallback))
    }
}
