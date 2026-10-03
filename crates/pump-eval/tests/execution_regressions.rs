mod common;

use pump_chart::{Fraction, Music, Note, TempoSegment};
use pump_eval::{RejectionKind, assess};

use common::{TestResult, contract, music};

fn coarse_music() -> Result<Music, pump_chart::FractionError> {
    Ok(Music {
        duration_ticks: 192,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [8; 32],
        reference_accents: Vec::new(),
    })
}

#[test]
fn future_hold_block_is_an_ordinary_physical_rejection() -> TestResult {
    let chart = pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes: vec![
            Note {
                tick: 0,
                panel_mask: (1 << 0) | (1 << 5),
                hold_ticks: 96,
            },
            Note {
                tick: 48,
                panel_mask: (1 << 2) | (1 << 7),
                hold_ticks: 0,
            },
        ],
    };

    let assessment = assess(&chart, &music(Vec::new())?, &contract())?;

    assert!(!assessment.accepted);
    assert_eq!(assessment.execution.earliest_infeasible_frame, Some(1));
    assert!(
        assessment
            .rejections
            .iter()
            .any(|rejection| rejection.kind == RejectionKind::Physical)
    );
    Ok(())
}

#[test]
fn released_foot_gets_only_post_release_travel_time() -> TestResult {
    let notes = vec![
        Note {
            tick: 0,
            panel_mask: 1 << 0,
            hold_ticks: 4,
        },
        Note {
            tick: 0,
            panel_mask: 1 << 4,
            hold_ticks: 8,
        },
    ];
    let mut too_soon = notes.clone();
    too_soon.push(Note {
        tick: 5,
        panel_mask: 1 << 9,
        hold_ticks: 0,
    });
    let mut enough_time = notes;
    enough_time.push(Note {
        tick: 9,
        panel_mask: 1 << 9,
        hold_ticks: 0,
    });
    let chart = |notes| pump_chart::Chart {
        ticks_per_beat: 4,
        span_ticks: 192,
        notes,
    };

    let rejected = assess(&chart(too_soon), &coarse_music()?, &contract())?;
    let accepted = assess(&chart(enough_time), &coarse_music()?, &contract())?;

    assert!(!rejected.accepted);
    assert_eq!(rejected.execution.earliest_infeasible_frame, Some(2));
    assert!(accepted.accepted);
    Ok(())
}

#[test]
fn repeated_contacts_reset_each_foots_travel_clock() -> TestResult {
    let chart = |final_tick| pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes: vec![
            Note {
                tick: 0,
                panel_mask: (1 << 0) | (1 << 5),
                hold_ticks: 0,
            },
            Note {
                tick: 48,
                panel_mask: (1 << 0) | (1 << 5),
                hold_ticks: 0,
            },
            Note {
                tick: final_tick,
                panel_mask: (1 << 4) | (1 << 9),
                hold_ticks: 0,
            },
        ],
    };

    let too_soon = assess(&chart(49), &music(Vec::new())?, &contract())?;
    let enough_time = assess(&chart(68), &music(Vec::new())?, &contract())?;

    assert!(!too_soon.accepted);
    assert_eq!(too_soon.execution.earliest_infeasible_frame, Some(2));
    assert!(enough_time.accepted);
    Ok(())
}
