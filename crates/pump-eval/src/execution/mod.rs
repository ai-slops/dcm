mod bounds;
mod model;
mod search;
mod timing;
mod transition;

pub use model::{Contact, Foot, FootPose, FramePath, PosePair, RouteWindow};

use pump_chart::{Chart, Music};

use crate::{EvalContract, EvalError, ExecutionReport};

pub(crate) fn evaluate(
    chart: &Chart,
    music: &Music,
    contract: &EvalContract,
) -> Result<ExecutionReport, EvalError> {
    search::evaluate(chart, music, contract)
}
