use serde::{Deserialize, Serialize};

use crate::MetricVector;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Foot {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FootPose {
    Off,
    Single { panel: u8 },
    Bracket { first: u8, second: u8 },
}

impl FootPose {
    pub(crate) fn from_mask(mask: u16) -> Option<Self> {
        match mask.count_ones() {
            0 => Some(Self::Off),
            1 => Some(Self::Single {
                panel: mask.trailing_zeros().try_into().ok()?,
            }),
            2 => {
                let first: u8 = mask.trailing_zeros().try_into().ok()?;
                let remaining = mask & !(1_u16 << first);
                let second: u8 = remaining.trailing_zeros().try_into().ok()?;
                if bracket_allowed(first, second) {
                    Some(Self::Bracket { first, second })
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    pub(crate) const fn is_bracket(self) -> bool {
        matches!(self, Self::Bracket { .. })
    }
}

const fn bracket_allowed(first: u8, second: u8) -> bool {
    let low = if first < second { first } else { second };
    let high = if first < second { second } else { first };
    matches!(
        (low, high),
        (0, 2) | (1, 2) | (2, 3) | (2, 4) | (5, 7) | (6, 7) | (7, 8) | (7, 9)
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PosePair {
    pub left: FootPose,
    pub right: FootPose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contact {
    pub frame: u32,
    pub tick: u64,
    pub poses: PosePair,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FramePath {
    pub contacts: Vec<Contact>,
    pub objectives: MetricVector,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteWindow {
    pub rule_index: u32,
    pub start_tick: u64,
    pub end_tick: u64,
    pub minimum_movement: u64,
    pub maximum_movement: u64,
}

pub(crate) const fn panel_xy(panel: u8) -> (i16, i16) {
    let pad_x = if panel >= 5 { 3 } else { 0 };
    match panel % 5 {
        0 => (pad_x, 0),
        1 => (pad_x, 2),
        2 => (pad_x + 1, 1),
        3 => (pad_x + 2, 2),
        4 => (pad_x + 2, 0),
        _ => (0, 0),
    }
}

pub(crate) fn movement(from: FootPose, to: FootPose) -> u64 {
    match (center(from), center(to)) {
        (None, _) | (_, None) => 0,
        (Some((from_x, from_y)), Some((to_x, to_y))) => {
            u64::from(from_x.abs_diff(to_x) + from_y.abs_diff(to_y))
        }
    }
}

fn center(pose: FootPose) -> Option<(i16, i16)> {
    match pose {
        FootPose::Off => None,
        FootPose::Single { panel } => {
            let (x, y) = panel_xy(panel);
            Some((x * 2, y * 2))
        }
        FootPose::Bracket { first, second } => {
            let (first_x, first_y) = panel_xy(first);
            let (second_x, second_y) = panel_xy(second);
            Some((first_x + second_x, first_y + second_y))
        }
    }
}

pub(crate) fn crossed(poses: PosePair) -> bool {
    match (center(poses.left), center(poses.right)) {
        (Some((left_x, _)), Some((right_x, _))) => left_x > right_x,
        (None, _) | (_, None) => false,
    }
}
