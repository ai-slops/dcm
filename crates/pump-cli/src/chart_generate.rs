use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use pump_chart::{CandidateId, GeneratedChart, GenerationRequest, SignedFraction};
use pump_eval::CandidateReport;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::chart_cli::ChartGenerateArgs;
use crate::chart_commands::output;
use crate::chart_runtime::ChartRuntime;
use crate::cli::OutputFormat;

#[derive(Serialize)]
struct Explanation<'a> {
    generated: &'a GeneratedChart,
    assessment: Option<&'a CandidateReport>,
    schedule: Vec<ScheduleFrame>,
}

#[derive(Serialize)]
struct ScheduleFrame {
    tick: u64,
    releases: u16,
    presses: u16,
    taps: u16,
    song_time: SignedFraction,
}

#[derive(Serialize)]
struct SeedSweep {
    count: u32,
    unique_candidates: usize,
    varies: bool,
    history_fallbacks: u32,
    exhaustion_fallback: bool,
}

pub fn generate(args: &ChartGenerateArgs, format: OutputFormat, explain: bool) -> Result<()> {
    let bundle = crate::chart_bundle::load(&args.bundle)?;
    let request = GenerationRequest {
        seed: decode_32(&args.seed, "seed")?,
        history: args
            .history
            .iter()
            .map(|value| decode_32(value, "candidate ID").map(CandidateId))
            .collect::<Result<Vec<_>>>()?,
    };
    let request_bytes =
        pump_chart::encode_generation_request(&request).context("encode generation request")?;
    if let Some(path) = &args.request_out {
        fs::write(path, &request_bytes).context("write replay request")?;
    }
    let generated =
        ChartRuntime::new(&bundle.runtime_component)?.generate(&bundle.program, &request)?;
    if !explain {
        return output(&generated, format);
    }
    let candidate = bundle
        .report
        .candidates
        .iter()
        .find(|candidate| candidate.candidate_id == hex::encode(generated.candidate_id.0));
    let mut schedule = BTreeMap::new();
    for frame in pump_chart::frames(&generated.chart).context("build generated schedule")? {
        schedule.insert(frame.tick, frame);
    }
    for segment in &bundle.program.music.tempo {
        schedule
            .entry(segment.start_tick)
            .or_insert(empty_frame(segment.start_tick));
    }
    let duration = bundle.program.music.duration_ticks;
    schedule.entry(duration).or_insert(empty_frame(duration));
    let schedule = schedule
        .into_values()
        .map(|frame| {
            Ok(ScheduleFrame {
                tick: frame.tick,
                releases: frame.releases,
                presses: frame.presses,
                taps: frame.taps,
                song_time: pump_chart::song_time(&bundle.program.music, frame.tick)?,
            })
        })
        .collect::<Result<_>>()?;
    output(
        &Explanation {
            generated: &generated,
            assessment: candidate,
            schedule,
        },
        format,
    )
}

pub fn test_seeds(root: &Path, count: u32, format: OutputFormat) -> Result<()> {
    ensure!(
        count > 0 && count <= 10_000,
        "count must be between 1 and 10000"
    );
    let bundle = crate::chart_bundle::load(root)?;
    let runtime = ChartRuntime::new(&bundle.runtime_component)?;
    let mut candidates = BTreeSet::new();
    let mut fallback_count = 0_u32;
    for value in 0..count {
        let request = GenerationRequest {
            seed: Sha256::digest(value.to_le_bytes()).into(),
            history: Vec::new(),
        };
        let generated = runtime.generate(&bundle.program, &request)?;
        candidates.insert(hex::encode(generated.candidate_id.0));
        fallback_count = fallback_count
            .checked_add(u32::from(generated.allow_repeat_fallback))
            .context("fallback counter overflow")?;
    }
    let exhaustion_request = GenerationRequest {
        seed: [0_u8; 32],
        history: bundle
            .program
            .candidates
            .iter()
            .map(|candidate| candidate.id)
            .collect(),
    };
    let exhaustion_fallback = if exhaustion_request.history.len()
        <= usize::try_from(bundle.program.history_policy.max_request_history)
            .context("history limit conversion")?
    {
        runtime
            .generate(&bundle.program, &exhaustion_request)?
            .allow_repeat_fallback
    } else {
        false
    };
    output(
        &SeedSweep {
            count,
            unique_candidates: candidates.len(),
            varies: candidates.len() > 1,
            history_fallbacks: fallback_count,
            exhaustion_fallback,
        },
        format,
    )
}

fn empty_frame(tick: u64) -> pump_chart::Frame {
    pump_chart::Frame {
        tick,
        releases: 0,
        presses: 0,
        taps: 0,
    }
}

pub(crate) fn decode_32(value: &str, label: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(value).with_context(|| format!("{label} must be hexadecimal"))?;
    if bytes.len() != 32 {
        bail!("{label} must decode to exactly 32 bytes");
    }
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("{label} has invalid length"))
}

#[cfg(test)]
mod tests {
    use pump_chart::{CandidateId, Chart, Fraction, GeneratedChart};

    use super::Explanation;

    #[test]
    fn explanation_serializes_u128_values_above_json_u64_range() -> anyhow::Result<()> {
        let generated = GeneratedChart {
            candidate_id: CandidateId([0; 32]),
            chart: Chart {
                ticks_per_beat: 4,
                span_ticks: 1,
                notes: Vec::new(),
            },
            program_sha256: [0; 32],
            request_sha256: [0; 32],
            base_ratio: Fraction::new(u128::from(u64::MAX) + 1, u128::MAX)?,
            history_conditioned_ratio: Fraction::ONE,
            eligible_weight: u128::MAX,
            allow_repeat_fallback: false,
        };

        let encoded = serde_json::to_string(&Explanation {
            generated: &generated,
            assessment: None,
            schedule: Vec::new(),
        })?;

        assert!(encoded.contains(&u128::MAX.to_string()));
        Ok(())
    }
}
