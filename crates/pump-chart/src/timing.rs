use crate::{Fraction, Music, SignedFraction, TimingError, validate_music};

pub fn elapsed_time(
    music: &Music,
    start_tick: u64,
    end_tick: u64,
) -> Result<Fraction, TimingError> {
    validate_music(music)?;
    if start_tick > end_tick || end_tick > music.duration_ticks {
        return Err(TimingError::TickOutsideMusic);
    }
    let mut elapsed = Fraction::ZERO;
    for (index, segment) in music.tempo.iter().enumerate() {
        let segment_end = music
            .tempo
            .get(index + 1)
            .map_or(music.duration_ticks, |next| next.start_tick);
        let overlap_start = start_tick.max(segment.start_tick);
        let overlap_end = end_tick.min(segment_end);
        if overlap_start >= overlap_end {
            continue;
        }
        let ticks = Fraction::new(
            u128::from(overlap_end - overlap_start),
            u128::from(music.ticks_per_beat),
        )?;
        elapsed = elapsed.checked_add(ticks.checked_mul(segment.micros_per_beat)?)?;
    }
    Ok(elapsed)
}

pub fn song_time(music: &Music, tick: u64) -> Result<SignedFraction, TimingError> {
    let elapsed = elapsed_time(music, 0, tick)?;
    let offset = Fraction::new(u128::from(music.offset_micros.unsigned_abs()), 1)?;
    if music.offset_micros >= 0 {
        return Ok(SignedFraction {
            negative: false,
            magnitude: elapsed.checked_add(offset)?,
        });
    }
    if elapsed >= offset {
        Ok(SignedFraction {
            negative: false,
            magnitude: crate::fraction::checked_sub(elapsed, offset)?,
        })
    } else {
        Ok(SignedFraction {
            negative: true,
            magnitude: crate::fraction::checked_sub(offset, elapsed)?,
        })
    }
}
