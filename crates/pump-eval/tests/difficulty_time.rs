mod common;

use pump_chart::{Fraction, Music, Note, TempoSegment};
use pump_eval::assess;

use common::{TestResult, contract};

fn music(micros_per_beat: u128) -> Result<Music, pump_chart::FractionError> {
    let mut music = common::music(Vec::new())?;
    music.offset_micros = -200_000;
    music.tempo = vec![TempoSegment {
        start_tick: 0,
        micros_per_beat: Fraction::new(micros_per_beat, 1)?,
    }];
    music.audio_sha256 = [9; 32];
    Ok(music)
}

fn chart(notes: Vec<Note>) -> pump_chart::Chart {
    pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes,
    }
}

#[test]
fn faster_tempo_increases_elapsed_time_density_and_local_load() -> TestResult {
    let notes = vec![
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 0,
        },
        Note {
            tick: 48,
            panel_mask: 2,
            hold_ticks: 0,
        },
    ];
    let slow = assess(&chart(notes.clone()), &music(1_000_000)?, &contract())?;
    let fast = assess(&chart(notes), &music(500_000)?, &contract())?;

    assert!(fast.difficulty.minimum.density > slow.difficulty.minimum.density);
    assert!(fast.difficulty.maximum.local_load > slow.difficulty.maximum.local_load);
    assert!(
        fast.difficulty.local_windows[0].duration_micros
            < slow.difficulty.local_windows[0].duration_micros
    );
    Ok(())
}

#[test]
fn longer_hold_increases_time_integral_occupancy() -> TestResult {
    let short = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 48,
        }]),
        &music(500_000)?,
        &contract(),
    )?;
    let long = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 96,
        }]),
        &music(500_000)?,
        &contract(),
    )?;

    assert!(long.difficulty.minimum.hold_occupancy > short.difficulty.minimum.hold_occupancy);
    assert_eq!(
        long.difficulty.minimum.hold_occupancy,
        short.difficulty.minimum.hold_occupancy * 2
    );
    Ok(())
}
