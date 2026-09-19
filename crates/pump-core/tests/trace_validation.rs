use pump_core::{Command, CommandTrace, FORMAT_VERSION, decode_trace, encode_trace};

fn valid_trace() -> CommandTrace {
    CommandTrace {
        version: FORMAT_VERSION,
        plan_digest: "00".repeat(32),
        seed_digest: "11".repeat(32),
        duration: 4,
        commands: vec![Command {
            tick: 0,
            duration: 1,
            panel_mask: 1,
            decision_id: "tap".to_owned(),
            provenance: "source".to_owned(),
        }],
    }
}

fn decoded(trace: &CommandTrace) -> Result<CommandTrace, pump_core::PlanError> {
    encode_trace(trace).and_then(|bytes| decode_trace(&bytes))
}

#[test]
fn trace_roundtrips_when_semantically_valid() {
    // Given
    let trace = valid_trace();

    // When
    let decoded = decoded(&trace).expect("decode");

    // Then
    assert_eq!(decoded, trace);
}

#[test]
fn trace_rejects_invalid_digest_mask_duration_and_bounds() {
    // Given / When / Then
    let mut trace = valid_trace();
    trace.plan_digest = "not-a-digest".to_owned();
    assert!(decoded(&trace).is_err());
    trace = valid_trace();
    trace.commands[0].panel_mask = 0;
    assert!(decoded(&trace).is_err());
    trace = valid_trace();
    trace.commands[0].duration = 0;
    assert!(decoded(&trace).is_err());
    trace = valid_trace();
    trace.commands[0].tick = 4;
    assert!(decoded(&trace).is_err());
}

#[test]
fn trace_rejects_noncanonical_order_and_overlapping_panels() {
    // Given
    let mut unordered = valid_trace();
    unordered.commands = vec![
        Command {
            tick: 1,
            duration: 1,
            panel_mask: 2,
            decision_id: "b".to_owned(),
            provenance: String::new(),
        },
        Command {
            tick: 0,
            duration: 1,
            panel_mask: 1,
            decision_id: "a".to_owned(),
            provenance: String::new(),
        },
    ];
    let mut overlap = valid_trace();
    overlap.commands = vec![
        Command {
            tick: 0,
            duration: 3,
            panel_mask: 1,
            decision_id: "a".to_owned(),
            provenance: String::new(),
        },
        Command {
            tick: 2,
            duration: 1,
            panel_mask: 1,
            decision_id: "b".to_owned(),
            provenance: String::new(),
        },
    ];

    // When / Then
    assert!(decoded(&unordered).is_err());
    assert!(decoded(&overlap).is_err());
}
