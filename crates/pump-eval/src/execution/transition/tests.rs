use pump_chart::{Chart, Note};

use super::events;

#[test]
fn events_index_hold_endpoints_by_panel_once() -> Result<(), crate::EvalError> {
    let chart = Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes: vec![
            Note {
                tick: 12,
                panel_mask: (1 << 0) | (1 << 4),
                hold_ticks: 24,
            },
            Note {
                tick: 12,
                panel_mask: 1 << 5,
                hold_ticks: 48,
            },
        ],
    };

    let indexed = events(&chart)?;
    let start = indexed
        .first()
        .ok_or_else(|| crate::EvalError::InvalidChart("missing indexed hold start event".into()))?;

    assert_eq!(start.hold_ends[0], 36);
    assert_eq!(start.hold_ends[4], 36);
    assert_eq!(start.hold_ends[5], 60);
    assert_eq!(start.hold_ends[1], 0);
    Ok(())
}
