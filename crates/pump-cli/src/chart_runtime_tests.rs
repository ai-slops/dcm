use pump_chart::{
    Chart, Fraction, GenerationRequest, HistoryPolicy, Music, Note, RuntimeProgram, TempoSegment,
    WeightedChart,
};

use crate::chart_runtime::validate_selection;

fn program() -> anyhow::Result<RuntimeProgram> {
    let music = Music {
        duration_ticks: 4,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };
    let charts = [1_u16, 2]
        .into_iter()
        .enumerate()
        .map(|(index, panel_mask)| {
            Ok(WeightedChart {
                chart: Chart {
                    ticks_per_beat: 4,
                    span_ticks: 4,
                    notes: vec![Note {
                        tick: 0,
                        panel_mask,
                        hold_ticks: 0,
                    }],
                },
                prior_mass: Fraction::new(if index == 0 { 1 } else { 3 }, 4)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(pump_chart::build_runtime(
        music,
        &charts,
        HistoryPolicy {
            recent_window: 2,
            max_request_history: 4,
        },
    )?)
}

#[test]
fn runtime_cannot_forge_probability_metadata_for_a_valid_candidate() -> anyhow::Result<()> {
    let program = program()?;
    let request = GenerationRequest {
        seed: [3; 32],
        history: Vec::new(),
    };
    let mut forged = pump_chart::generate(&program, &request)?;
    forged.base_ratio = Fraction::ONE;
    forged.history_conditioned_ratio = Fraction::ONE;
    forged.eligible_weight = 1;
    assert!(validate_selection(&program, &request, &forged).is_err());
    Ok(())
}

#[test]
fn runtime_cannot_substitute_another_valid_chart_for_the_same_request() -> anyhow::Result<()> {
    let program = program()?;
    let request = GenerationRequest {
        seed: [3; 32],
        history: Vec::new(),
    };
    let mut forged = pump_chart::generate(&program, &request)?;
    let other = program
        .candidates
        .iter()
        .find(|candidate| candidate.id != forged.candidate_id)
        .ok_or_else(|| anyhow::anyhow!("fixture needs two candidates"))?;
    forged.candidate_id = other.id;
    forged.chart = other.chart.clone();
    assert!(validate_selection(&program, &request, &forged).is_err());
    Ok(())
}

#[test]
fn runtime_cannot_claim_history_fallback_when_no_history_was_supplied() -> anyhow::Result<()> {
    let program = program()?;
    let request = GenerationRequest {
        seed: [3; 32],
        history: Vec::new(),
    };
    let mut forged = pump_chart::generate(&program, &request)?;
    forged.allow_repeat_fallback = true;
    assert!(validate_selection(&program, &request, &forged).is_err());
    Ok(())
}
