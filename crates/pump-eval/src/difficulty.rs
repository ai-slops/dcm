use pump_chart::{Chart, Fraction, Music};

use crate::{
    DifficultyReport, DifficultySignals, EvalContract, EvalError, ExecutionReport, LocalWindow,
    MetricRange, Rejection, RejectionKind,
};

pub(crate) fn evaluate(
    chart: &Chart,
    music: &Music,
    contract: &EvalContract,
    execution: &ExecutionReport,
) -> Result<DifficultyReport, EvalError> {
    let density = density(chart, music)?;
    let hold_occupancy = hold_occupancy(chart, music)?;
    let mut local_windows = Vec::with_capacity(execution.route_windows.len());
    let mut local_minimum = u64::MAX;
    let mut local_maximum = 0_u64;
    for window in &execution.route_windows {
        let note_panels = chart
            .notes
            .iter()
            .filter(|note| note.tick >= window.start_tick && note.tick < window.end_tick)
            .try_fold(0_u128, |sum, note| {
                sum.checked_add(u128::from(note.panel_mask.count_ones()))
                    .ok_or(EvalError::ArithmeticOverflow)
            })?;
        let end_tick = window.end_tick.min(music.duration_ticks);
        let duration_micros = elapsed(music, window.start_tick, end_tick)?;
        let note_load = rate_per_second(note_panels, duration_micros)?;
        let minimum_load = note_load
            .checked_add(window.minimum_movement)
            .ok_or(EvalError::ArithmeticOverflow)?;
        let maximum_load = note_load
            .checked_add(window.maximum_movement)
            .ok_or(EvalError::ArithmeticOverflow)?;
        local_minimum = local_minimum.min(minimum_load);
        local_maximum = local_maximum.max(maximum_load);
        local_windows.push(LocalWindow {
            start_tick: window.start_tick,
            end_tick: window.end_tick,
            duration_micros,
            minimum_load,
            maximum_load,
        });
    }
    if local_windows.is_empty() {
        local_minimum = 0;
    }
    let minimum = DifficultySignals {
        density,
        movement: execution.min_objectives.movement,
        brackets: execution.min_objectives.brackets,
        hold_occupancy,
        local_load: local_minimum,
        total: density
            .checked_add(execution.min_total_objective)
            .ok_or(EvalError::ArithmeticOverflow)?,
    };
    let maximum = DifficultySignals {
        density,
        movement: execution.max_objectives.movement,
        brackets: execution.max_objectives.brackets,
        hold_occupancy,
        local_load: local_maximum,
        total: density
            .checked_add(execution.max_total_objective)
            .ok_or(EvalError::ArithmeticOverflow)?,
    };
    let mut rejections = Vec::new();
    check_range(
        "density",
        contract.difficulty.density,
        minimum.density,
        maximum.density,
        &mut rejections,
    );
    check_range(
        "movement",
        contract.difficulty.movement,
        minimum.movement,
        maximum.movement,
        &mut rejections,
    );
    check_range(
        "brackets",
        contract.difficulty.brackets,
        minimum.brackets,
        maximum.brackets,
        &mut rejections,
    );
    check_range(
        "hold_occupancy",
        contract.difficulty.hold_occupancy,
        minimum.hold_occupancy,
        maximum.hold_occupancy,
        &mut rejections,
    );
    check_range(
        "local_load",
        contract.difficulty.local_load,
        minimum.local_load,
        maximum.local_load,
        &mut rejections,
    );
    check_range(
        "total",
        contract.difficulty.total,
        minimum.total,
        maximum.total,
        &mut rejections,
    );
    for (index, window) in local_windows.iter().enumerate() {
        let rule_index = usize::try_from(execution.route_windows[index].rule_index)
            .map_err(|_| EvalError::ArithmeticOverflow)?;
        if let Some(rule) = contract.difficulty.local_windows.get(rule_index)
            && window.maximum_load > rule.maximum_load
        {
            rejections.push(rejection(
                RejectionKind::DifficultyMaximum,
                &format!("local_window_{index}"),
                window.maximum_load,
                rule.maximum_load,
            ));
        }
    }
    Ok(DifficultyReport {
        model: format!("{} (uncalibrated rule model)", contract.difficulty.label),
        uncalibrated: true,
        minimum,
        maximum,
        local_windows,
        rejections,
    })
}

fn density(chart: &Chart, music: &Music) -> Result<u64, EvalError> {
    let panels = chart.notes.iter().try_fold(0_u128, |sum, note| {
        sum.checked_add(u128::from(note.panel_mask.count_ones()))
            .ok_or(EvalError::ArithmeticOverflow)
    })?;
    rate_per_second(panels, elapsed(music, 0, chart.span_ticks)?)
}

fn hold_occupancy(chart: &Chart, music: &Music) -> Result<u64, EvalError> {
    let mut total = Fraction::ZERO;
    for note in chart.notes.iter().filter(|note| note.hold_ticks > 0) {
        let end = note
            .tick
            .checked_add(note.hold_ticks)
            .ok_or(EvalError::ArithmeticOverflow)?;
        let panels = Fraction::new(u128::from(note.panel_mask.count_ones()), 1)
            .map_err(|_| EvalError::ArithmeticOverflow)?;
        total = total
            .checked_add(
                elapsed(music, note.tick, end)?
                    .checked_mul(panels)
                    .map_err(|_| EvalError::ArithmeticOverflow)?,
            )
            .map_err(|_| EvalError::ArithmeticOverflow)?;
    }
    u64::try_from(total.numerator() / total.denominator())
        .map_err(|_| EvalError::ArithmeticOverflow)
}

fn rate_per_second(units: u128, duration_micros: Fraction) -> Result<u64, EvalError> {
    if duration_micros.numerator() == 0 {
        return Ok(0);
    }
    let scaled = units
        .checked_mul(1_000_000_000)
        .and_then(|value| value.checked_mul(duration_micros.denominator()))
        .ok_or(EvalError::ArithmeticOverflow)?
        / duration_micros.numerator();
    u64::try_from(scaled).map_err(|_| EvalError::ArithmeticOverflow)
}

fn elapsed(music: &Music, start_tick: u64, end_tick: u64) -> Result<Fraction, EvalError> {
    pump_chart::elapsed_time(music, start_tick, end_tick)
        .map_err(|error| EvalError::InvalidChart(error.to_string()))
}

fn check_range(
    id: &str,
    range: MetricRange,
    minimum: u64,
    maximum: u64,
    output: &mut Vec<Rejection>,
) {
    if minimum < range.minimum {
        output.push(rejection(
            RejectionKind::DifficultyMinimum,
            id,
            minimum,
            range.minimum,
        ));
    }
    if maximum > range.maximum {
        output.push(rejection(
            RejectionKind::DifficultyMaximum,
            id,
            maximum,
            range.maximum,
        ));
    }
}

fn rejection(kind: RejectionKind, id: &str, observed: u64, required: u64) -> Rejection {
    Rejection {
        kind,
        rule_id: Some(id.into()),
        observed: Some(observed),
        required: Some(required),
        frame: None,
        explanation: "difficulty envelope condition failed".into(),
    }
}
