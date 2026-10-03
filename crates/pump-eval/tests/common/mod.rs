use pump_chart::{Fraction, Music, TempoSegment};
use pump_eval::{
    DifficultyEnvelope, EvalBudgets, EvalContract, FootModel, LocalWindowRule, MetricRange,
};

pub type TestResult = Result<(), Box<dyn std::error::Error>>;

pub fn music(accents: Vec<u64>) -> Result<Music, pump_chart::FractionError> {
    Ok(Music {
        duration_ticks: 192,
        ticks_per_beat: 48,
        offset_micros: -125_000,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [7; 32],
        reference_accents: accents,
    })
}

fn range() -> MetricRange {
    MetricRange {
        minimum: 0,
        maximum: u64::MAX,
    }
}

pub fn contract() -> EvalContract {
    EvalContract {
        schema_version: 2,
        foot_model: FootModel {
            version: 1,
            micros_per_panel_unit: 50_000,
            bracket_setup_micros: 20_000,
            crossover_penalty: 2,
            bracket_penalty: 3,
        },
        difficulty: DifficultyEnvelope {
            label: "test-rule-v1".into(),
            density: range(),
            movement: range(),
            brackets: range(),
            hold_occupancy: range(),
            local_load: range(),
            total: range(),
            local_windows: vec![LocalWindowRule {
                width_ticks: 48,
                maximum_load: u64::MAX,
            }],
        },
        intents: Vec::new(),
        budgets: EvalBudgets {
            max_notes: 64,
            max_frames: 64,
            max_dp_work: 100_000,
            max_matching_work: 100_000,
        },
        history_policy: pump_chart::HistoryPolicy {
            recent_window: 2,
            max_request_history: 8,
        },
    }
}
