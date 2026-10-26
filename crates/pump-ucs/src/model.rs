use pump_chart::{Chart, Music};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum UcsMode {
    Single,
    Double,
}

impl UcsMode {
    pub(crate) const fn lanes(self) -> usize {
        match self {
            Self::Single => 5,
            Self::Double => 10,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UcsChart {
    pub mode: UcsMode,
    pub chart: Chart,
    pub music: Music,
}
