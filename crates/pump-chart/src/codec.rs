use crate::decode::Decoder;
use crate::encode::Encoder;
use crate::{
    CodecError, GeneratedChart, GenerationRequest, Limits, Plan, RuntimeProgram, candidate_id,
    validate_chart, validate_music, validate_plan,
};

const PLAN_MAGIC: [u8; 4] = *b"PCP2";
const RUNTIME_MAGIC: [u8; 4] = *b"PCR2";
const REQUEST_MAGIC: [u8; 4] = *b"PCQ2";
const GENERATED_MAGIC: [u8; 4] = *b"PCG2";

pub fn encode_plan(plan: &Plan) -> Result<Vec<u8>, CodecError> {
    encode_plan_with_limits(plan, &Limits::default())
}

pub fn encode_plan_with_limits(plan: &Plan, limits: &Limits) -> Result<Vec<u8>, CodecError> {
    validate_music_limits(&plan.music, limits)?;
    validate_plan(plan, limits)?;
    let mut encoder = Encoder::new(PLAN_MAGIC, limits.max_codec_bytes)?;
    encoder.plan(plan)?;
    Ok(encoder.finish())
}

pub fn decode_plan(bytes: &[u8], limits: &Limits) -> Result<Plan, CodecError> {
    let mut decoder = Decoder::new(bytes, limits, PLAN_MAGIC)?;
    let plan = decoder.plan()?;
    decoder.finish()?;
    validate_plan(&plan, limits)?;
    Ok(plan)
}

pub fn encode_runtime_program(program: &RuntimeProgram) -> Result<Vec<u8>, CodecError> {
    encode_runtime_program_with_limits(program, &Limits::default())
}

pub fn encode_runtime_program_with_limits(
    program: &RuntimeProgram,
    limits: &Limits,
) -> Result<Vec<u8>, CodecError> {
    validate_runtime(program, limits)?;
    let mut encoder = Encoder::new(RUNTIME_MAGIC, limits.max_codec_bytes)?;
    encoder.runtime(program)?;
    Ok(encoder.finish())
}

pub fn decode_runtime_program(bytes: &[u8], limits: &Limits) -> Result<RuntimeProgram, CodecError> {
    let mut decoder = Decoder::new(bytes, limits, RUNTIME_MAGIC)?;
    let program = decoder.runtime()?;
    decoder.finish()?;
    validate_runtime(&program, limits)?;
    Ok(program)
}

pub fn encode_generation_request(request: &GenerationRequest) -> Result<Vec<u8>, CodecError> {
    let limits = Limits::default();
    if request.history.len()
        > usize::try_from(crate::MAX_REQUEST_HISTORY).map_err(|_| CodecError::LengthLimit)?
    {
        return Err(CodecError::LengthLimit);
    }
    let mut encoder = Encoder::new(REQUEST_MAGIC, limits.max_codec_bytes)?;
    encoder.request(request)?;
    Ok(encoder.finish())
}

pub fn decode_generation_request(
    bytes: &[u8],
    limits: &Limits,
) -> Result<GenerationRequest, CodecError> {
    let mut decoder = Decoder::new(bytes, limits, REQUEST_MAGIC)?;
    let request = decoder.request()?;
    decoder.finish()?;
    Ok(request)
}

pub fn encode_generated_chart(generated: &GeneratedChart) -> Result<Vec<u8>, CodecError> {
    let limits = Limits::default();
    validate_generated(generated, &limits)?;
    let mut encoder = Encoder::new(GENERATED_MAGIC, limits.max_codec_bytes)?;
    encoder.generated(generated)?;
    Ok(encoder.finish())
}

pub fn decode_generated_chart(bytes: &[u8], limits: &Limits) -> Result<GeneratedChart, CodecError> {
    let mut decoder = Decoder::new(bytes, limits, GENERATED_MAGIC)?;
    let generated = decoder.generated()?;
    decoder.finish()?;
    validate_generated(&generated, limits)?;
    Ok(generated)
}

fn validate_music_limits(music: &crate::Music, limits: &Limits) -> Result<(), CodecError> {
    crate::validate_limits(limits)?;
    if music.tempo.len() > usize::try_from(limits.max_nodes).map_err(|_| CodecError::LengthLimit)?
        || music.reference_accents.len()
            > usize::try_from(limits.max_total_events).map_err(|_| CodecError::LengthLimit)?
    {
        return Err(CodecError::LengthLimit);
    }
    validate_music(music)?;
    Ok(())
}

fn validate_chart_limits(chart: &crate::Chart, limits: &Limits) -> Result<(), CodecError> {
    if chart.notes.len()
        > usize::try_from(limits.max_trace_notes).map_err(|_| CodecError::LengthLimit)?
    {
        return Err(CodecError::LengthLimit);
    }
    validate_chart(chart)?;
    Ok(())
}

fn validate_runtime(program: &RuntimeProgram, limits: &Limits) -> Result<(), CodecError> {
    validate_music_limits(&program.music, limits)?;
    if program.candidates.is_empty()
        || program.candidates.len()
            > usize::try_from(limits.max_derivations).map_err(|_| CodecError::LengthLimit)?
        || program.history_policy.recent_window > program.history_policy.max_request_history
        || program.history_policy.max_request_history > crate::MAX_REQUEST_HISTORY
    {
        return Err(CodecError::LengthLimit);
    }
    let mut mass = crate::Fraction::ZERO;
    let mut previous = None;
    let mut weight_divisor = 0_u128;
    let mut proportionality = None;
    for candidate in &program.candidates {
        validate_chart_limits(&candidate.chart, limits)?;
        if candidate.chart.ticks_per_beat != program.music.ticks_per_beat
            || candidate.chart.span_ticks != program.music.duration_ticks
            || candidate.weight == 0
            || candidate_id(&candidate.chart)? != candidate.id
            || previous.is_some_and(|id| id >= candidate.id)
            || candidate.original_prior_mass.numerator() == 0
        {
            return Err(CodecError::LengthLimit);
        }
        mass = mass.checked_add(candidate.original_prior_mass)?;
        weight_divisor = crate::fraction::gcd(weight_divisor, candidate.weight);
        let ratio = crate::Fraction::new(candidate.weight, 1)?
            .checked_div(candidate.original_prior_mass)?;
        if proportionality.is_some_and(|expected| expected != ratio) {
            return Err(CodecError::LengthLimit);
        }
        proportionality = Some(ratio);
        previous = Some(candidate.id);
    }
    if mass != program.original_mass || weight_divisor != 1 {
        return Err(CodecError::LengthLimit);
    }
    Ok(())
}

fn validate_generated(generated: &GeneratedChart, limits: &Limits) -> Result<(), CodecError> {
    crate::validate_limits(limits)?;
    validate_chart_limits(&generated.chart, limits)?;
    if candidate_id(&generated.chart)? != generated.candidate_id
        || generated.base_ratio.numerator() == 0
        || generated.base_ratio > crate::Fraction::ONE
        || generated.history_conditioned_ratio.numerator() == 0
        || generated.history_conditioned_ratio > crate::Fraction::ONE
        || generated.eligible_weight == 0
    {
        return Err(CodecError::LengthLimit);
    }
    Ok(())
}
