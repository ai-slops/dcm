use pump_chart::{Chart, Music, Note, TempoSegment};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::beat::{Beat, BeatGridSection, BeatNote, BeatTempoSegment, BeatUcsChart, gcd};
use crate::{UcsChart, UcsMode};

const NATIVE_TPB_LIMIT: u64 = 4_096;
const NATIVE_TICK_LIMIT: u64 = 1_000_000;

#[derive(Clone, Debug, Eq, Error, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum NativeProjectionError {
    #[error("exact native grid requires {required_tpb} ticks per beat, above limit {limit}")]
    GridUnsupported { required_tpb: u64, limit: u64 },
    #[error("exact native projection exceeds the {field} limit of {limit}")]
    Limit { field: &'static str, limit: u64 },
    #[error("exact native projection arithmetic overflow")]
    Overflow,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NativeBeatProjection {
    pub mode: UcsMode,
    pub chart: Chart,
    pub music: Music,
    pub grid_sections: Vec<BeatGridSection>,
}

pub fn project_beats_native(
    source: &BeatUcsChart,
) -> Result<NativeBeatProjection, NativeProjectionError> {
    let required_tpb = required_tpb(source)?;
    if required_tpb > NATIVE_TPB_LIMIT {
        return Err(NativeProjectionError::GridUnsupported {
            required_tpb,
            limit: NATIVE_TPB_LIMIT,
        });
    }
    let tpb = u32::try_from(required_tpb).map_err(|_| NativeProjectionError::Overflow)?;
    let span_ticks = to_tick(source.duration, required_tpb)?;
    if span_ticks > NATIVE_TICK_LIMIT {
        return Err(NativeProjectionError::Limit {
            field: "duration_ticks",
            limit: NATIVE_TICK_LIMIT,
        });
    }
    if source.notes.len() > 10_000 {
        return Err(NativeProjectionError::Limit {
            field: "notes",
            limit: 10_000,
        });
    }
    if source.tempo.len() > 4_096 || source.grid_sections.len() > 4_096 {
        return Err(NativeProjectionError::Limit {
            field: "sections",
            limit: 4_096,
        });
    }
    let notes = source
        .notes
        .iter()
        .map(|note| {
            Ok(Note {
                tick: to_tick(note.at, required_tpb)?,
                panel_mask: note.panel_mask,
                hold_ticks: to_tick(note.hold, required_tpb)?,
            })
        })
        .collect::<Result<Vec<_>, NativeProjectionError>>()?;
    let tempo = source
        .tempo
        .iter()
        .map(|segment| {
            Ok(TempoSegment {
                start_tick: to_tick(segment.at, required_tpb)?,
                micros_per_beat: segment.micros_per_beat,
            })
        })
        .collect::<Result<Vec<_>, NativeProjectionError>>()?;
    let reference_accents = source
        .reference_accents
        .iter()
        .copied()
        .map(|beat| to_tick(beat, required_tpb))
        .collect::<Result<Vec<_>, _>>()?;
    let chart = Chart {
        ticks_per_beat: tpb,
        span_ticks,
        notes,
    };
    let music = Music {
        duration_ticks: span_ticks,
        ticks_per_beat: tpb,
        offset_micros: source.offset_micros,
        tempo,
        audio_sha256: source.audio_sha256,
        reference_accents,
    };
    pump_chart::validate_chart(&chart).map_err(|_| NativeProjectionError::Limit {
        field: "chart",
        limit: NATIVE_TICK_LIMIT,
    })?;
    pump_chart::validate_music(&music).map_err(|_| NativeProjectionError::Limit {
        field: "music",
        limit: NATIVE_TICK_LIMIT,
    })?;
    Ok(NativeBeatProjection {
        mode: source.mode,
        chart,
        music,
        grid_sections: source.grid_sections.clone(),
    })
}

impl TryFrom<NativeBeatProjection> for BeatUcsChart {
    type Error = NativeProjectionError;

    fn try_from(value: NativeBeatProjection) -> Result<Self, Self::Error> {
        if value.chart.ticks_per_beat != value.music.ticks_per_beat
            || value.chart.span_ticks != value.music.duration_ticks
        {
            return Err(NativeProjectionError::Limit {
                field: "grid_mismatch",
                limit: NATIVE_TPB_LIMIT,
            });
        }
        let tpb = u64::from(value.chart.ticks_per_beat);
        let notes = value
            .chart
            .notes
            .into_iter()
            .map(|note| {
                Ok(BeatNote {
                    at: from_tick(note.tick, tpb)?,
                    hold: from_tick(note.hold_ticks, tpb)?,
                    panel_mask: note.panel_mask,
                })
            })
            .collect::<Result<Vec<_>, NativeProjectionError>>()?;
        let tempo = value
            .music
            .tempo
            .into_iter()
            .map(|segment| {
                Ok(BeatTempoSegment {
                    at: from_tick(segment.start_tick, tpb)?,
                    micros_per_beat: segment.micros_per_beat,
                })
            })
            .collect::<Result<Vec<_>, NativeProjectionError>>()?;
        let reference_accents = value
            .music
            .reference_accents
            .into_iter()
            .map(|tick| from_tick(tick, tpb))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            mode: value.mode,
            offset_micros: value.music.offset_micros,
            tempo,
            grid_sections: value.grid_sections,
            duration: from_tick(value.chart.span_ticks, tpb)?,
            notes,
            audio_sha256: value.music.audio_sha256,
            reference_accents,
        })
    }
}

impl From<NativeBeatProjection> for UcsChart {
    fn from(value: NativeBeatProjection) -> Self {
        Self {
            mode: value.mode,
            chart: value.chart,
            music: value.music,
        }
    }
}

fn required_tpb(source: &BeatUcsChart) -> Result<u64, NativeProjectionError> {
    let mut required = 1_u64;
    let beats = source
        .notes
        .iter()
        .flat_map(|note| [note.at, note.hold])
        .chain(source.tempo.iter().map(|segment| segment.at))
        .chain(source.grid_sections.iter().map(|section| section.at))
        .chain(source.reference_accents.iter().copied())
        .chain([source.duration]);
    for beat in beats {
        required = lcm(required, beat.denominator())?;
    }
    for section in &source.grid_sections {
        let row_denominator =
            u64::from(section.rows_per_measure) / gcd(4, u64::from(section.rows_per_measure));
        required = lcm(required, row_denominator)?;
    }
    Ok(required)
}

fn lcm(left: u64, right: u64) -> Result<u64, NativeProjectionError> {
    left.checked_div(gcd(left, right))
        .and_then(|value| value.checked_mul(right))
        .ok_or(NativeProjectionError::Overflow)
}

fn to_tick(beat: Beat, tpb: u64) -> Result<u64, NativeProjectionError> {
    let scaled = u128::from(beat.numerator())
        .checked_mul(u128::from(tpb))
        .ok_or(NativeProjectionError::Overflow)?;
    if !scaled.is_multiple_of(u128::from(beat.denominator())) {
        return Err(NativeProjectionError::Overflow);
    }
    u64::try_from(scaled / u128::from(beat.denominator()))
        .map_err(|_| NativeProjectionError::Overflow)
}

fn from_tick(tick: u64, tpb: u64) -> Result<Beat, NativeProjectionError> {
    Beat::new(tick, tpb).map_err(|_| NativeProjectionError::Overflow)
}
