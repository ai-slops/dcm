mod common;

use pump_chart::Limits;
use pump_core::{Builder, Node, RelationKind};

use common::{music, runtime, tap};

#[test]
fn source_and_music_duration_must_match() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let root = tap(&mut builder, 1, 4, "tap")?;
    let result = pump_bridge::convert(&runtime(builder, root)?, &music(5)?, &Limits::default());

    assert!(matches!(
        result,
        Err(pump_bridge::BridgeError::DurationMismatch {
            source_duration: 4,
            music_duration: 5
        })
    ));
    Ok(())
}

#[test]
fn malformed_runtime_metadata_is_rejected_by_v1_validation()
-> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let root = tap(&mut builder, 1, 4, "tap")?;
    let mut source = runtime(builder, root)?;
    source.max_trace -= 1;
    let result = pump_bridge::convert(&source, &music(4)?, &Limits::default());

    assert!(matches!(
        result,
        Err(pump_bridge::BridgeError::InvalidSource(_))
    ));
    Ok(())
}

#[test]
fn insufficient_work_is_rejected_before_large_repeat_expansion()
-> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let tap = tap(&mut builder, 1, 1, "tap")?;
    let root = builder.repeat(tap, 10_000, "repeat", "test")?;
    let limits = Limits {
        max_work: 20,
        ..Limits::default()
    };
    let result = pump_bridge::convert(&runtime(builder, root)?, &music(10_000)?, &limits);

    assert_eq!(result, Err(pump_bridge::BridgeError::LimitExceeded("work")));
    Ok(())
}

#[test]
fn invalid_target_music_is_rejected() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let root = tap(&mut builder, 1, 4, "tap")?;
    let mut target = music(4)?;
    target.tempo.clear();
    let result = pump_bridge::convert(&runtime(builder, root)?, &target, &Limits::default());

    assert!(matches!(
        result,
        Err(pump_bridge::BridgeError::InvalidTarget(_))
    ));
    Ok(())
}

#[test]
fn forged_relation_semantics_are_rejected_by_v1_validation()
-> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = tap(&mut builder, 1, 2, "left")?;
    let right = tap(&mut builder, 1, 2, "right")?;
    let root = builder.relation(RelationKind::Same, left, right, "relation", "test")?;
    let mut source = runtime(builder, root)?;
    source.nodes[usize::try_from(root.0)?].node = Node::Relation {
        kind: RelationKind::Different,
        left,
        right,
    };
    let result = pump_bridge::convert(&source, &music(4)?, &Limits::default());

    assert!(matches!(
        result,
        Err(pump_bridge::BridgeError::InvalidSource(_))
    ));
    Ok(())
}
