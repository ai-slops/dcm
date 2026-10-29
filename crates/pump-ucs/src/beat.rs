use pump_chart::Fraction;
use serde::{Deserialize, Deserializer, Serialize};

use crate::{UcsError, UcsMode};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
pub struct Beat {
    numerator: u64,
    denominator: u64,
}

impl Ord for Beat {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (u128::from(self.numerator) * u128::from(other.denominator))
            .cmp(&(u128::from(other.numerator) * u128::from(self.denominator)))
    }
}

impl PartialOrd for Beat {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Beat {
    pub fn new(numerator: u64, denominator: u64) -> Result<Self, UcsError> {
        if denominator == 0 {
            return Err(UcsError::InvalidBeat);
        }
        let divisor = gcd(numerator, denominator);
        Ok(Self {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        })
    }

    pub const fn numerator(self) -> u64 {
        self.numerator
    }
    pub const fn denominator(self) -> u64 {
        self.denominator
    }

    pub(crate) fn checked_add(self, other: Self) -> Result<Self, UcsError> {
        let numerator = u128::from(self.numerator)
            .checked_mul(u128::from(other.denominator))
            .and_then(|left| {
                u128::from(other.numerator)
                    .checked_mul(u128::from(self.denominator))
                    .and_then(|right| left.checked_add(right))
            })
            .ok_or(UcsError::Overflow)?;
        let denominator = u128::from(self.denominator)
            .checked_mul(u128::from(other.denominator))
            .ok_or(UcsError::Overflow)?;
        Self::from_u128(numerator, denominator)
    }

    pub(crate) fn checked_sub(self, other: Self) -> Result<Self, UcsError> {
        let left = u128::from(self.numerator) * u128::from(other.denominator);
        let right = u128::from(other.numerator) * u128::from(self.denominator);
        if left < right {
            return Err(UcsError::InvalidBeat);
        }
        Self::from_u128(
            left - right,
            u128::from(self.denominator) * u128::from(other.denominator),
        )
    }

    pub(crate) fn from_u128(numerator: u128, denominator: u128) -> Result<Self, UcsError> {
        let divisor = crate::decimal::gcd(numerator, denominator);
        Self::new(
            u64::try_from(numerator / divisor).map_err(|_| UcsError::Overflow)?,
            u64::try_from(denominator / divisor).map_err(|_| UcsError::Overflow)?,
        )
    }
}

impl<'de> Deserialize<'de> for Beat {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RawBeat {
            numerator: u64,
            denominator: u64,
        }
        let raw = RawBeat::deserialize(deserializer)?;
        Self::new(raw.numerator, raw.denominator).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeatNote {
    pub at: Beat,
    pub hold: Beat,
    pub panel_mask: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeatTempoSegment {
    pub at: Beat,
    pub micros_per_beat: Fraction,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeatGridSection {
    pub at: Beat,
    pub rows_per_measure: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeatUcsChart {
    pub mode: UcsMode,
    pub offset_micros: i64,
    pub tempo: Vec<BeatTempoSegment>,
    pub grid_sections: Vec<BeatGridSection>,
    pub duration: Beat,
    pub notes: Vec<BeatNote>,
    pub audio_sha256: [u8; 32],
    pub reference_accents: Vec<Beat>,
}

pub(crate) const fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}
