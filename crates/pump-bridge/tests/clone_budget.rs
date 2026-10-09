mod common;

use pump_bridge::{BridgeError, convert};
use pump_core::{Builder, ScopeKind};

#[test]
fn nested_context_copies_are_charged_before_fork_allocation()
-> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = common::tap(&mut builder, 1, 1, "left")?;
    let right = common::tap(&mut builder, 2, 1, "right")?;
    let first = builder.choice(&[(1, left), (1, right)], None, "old", "test")?;
    let mut scoped = first;
    for level in 0..4 {
        scoped = builder.scope(
            ScopeKind::Phrase,
            &"x".repeat(240),
            scoped,
            &format!("scope{level}"),
            "test",
        )?;
    }
    let second = builder.choice(&[(1, left), (1, right)], None, "new", "test")?;
    let root = builder.sequence(&[scoped, second], "root", "test")?;
    let source = common::runtime(builder, root)?;
    let limits = pump_chart::Limits {
        max_work: 4000,
        ..pump_chart::Limits::default()
    };
    assert!(matches!(
        convert(&source, &common::music(2)?, &limits),
        Err(BridgeError::LimitExceeded("work"))
    ));
    Ok(())
}
