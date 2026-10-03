use pump_chart::{Fraction, Limits, Music, Node, TempoSegment};
use wasmtime::StoreLimitsBuilder;
use wasmtime::component::Resource;

use super::{HostBuilder, HostState, plan_builder};

fn state(limits: Limits) -> anyhow::Result<(HostState, u32)> {
    let music = Music {
        duration_ticks: 16,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };
    let mut state = HostState::new(music, limits, StoreLimitsBuilder::new().build());
    let resource = <HostState as plan_builder::HostBuilder>::new(&mut state)?;
    Ok((state, resource.rep()))
}

fn resource(rep: u32) -> Resource<HostBuilder> {
    Resource::new_own(rep)
}

#[test]
fn invalid_nodes_are_rejected_before_arena_mutation() -> anyhow::Result<()> {
    let (mut state, rep) = state(Limits::default())?;
    let invalid = [
        Node::Tap {
            panel_mask: 0,
            key: "mask".into(),
        },
        Node::Hold {
            panel_mask: 1,
            duration_ticks: 0,
            key: "hold".into(),
        },
        Node::Rest {
            duration_ticks: 0,
            key: "rest".into(),
        },
        Node::Sequence {
            children: Vec::new(),
            key: "sequence".into(),
        },
        Node::Parallel {
            children: Vec::new(),
            key: "parallel".into(),
        },
        Node::Repeat {
            child: 0,
            count: 0,
            key: "repeat".into(),
        },
        Node::Choice {
            branches: Vec::new(),
            key: "choice".into(),
        },
        Node::Mirror {
            child: 0,
            key: String::new(),
        },
    ];

    for node in invalid {
        assert!(
            state
                .add_node(resource(rep), node, "test".into(), 0)?
                .is_err()
        );
    }

    let builder = state.builder(&resource(rep))?;
    assert!(builder.nodes.as_ref().is_some_and(Vec::is_empty));
    Ok(())
}

#[test]
fn duplicate_semantic_key_is_rejected_before_second_insert() -> anyhow::Result<()> {
    let (mut state, rep) = state(Limits::default())?;
    let first = Node::Tap {
        panel_mask: 1,
        key: "same".into(),
    };
    let second = Node::Tap {
        panel_mask: 2,
        key: "same".into(),
    };

    assert!(
        state
            .add_node(resource(rep), first, "first".into(), 0)?
            .is_ok()
    );
    assert!(
        state
            .add_node(resource(rep), second, "second".into(), 0)?
            .is_err()
    );

    let builder = state.builder(&resource(rep))?;
    assert_eq!(builder.nodes.as_ref().map(Vec::len), Some(1));
    Ok(())
}

#[test]
fn oversized_choice_is_rejected_before_branch_conversion() -> anyhow::Result<()> {
    let limits = Limits {
        max_edges: 1,
        ..Limits::default()
    };
    let (mut state, rep) = state(limits)?;
    let alternatives = vec![
        plan_builder::WeightedNode { weight: 1, node: 0 },
        plan_builder::WeightedNode { weight: 1, node: 0 },
    ];

    let result = <HostState as plan_builder::HostBuilder>::choice(
        &mut state,
        resource(rep),
        alternatives,
        "choice".into(),
        "test".into(),
    )?;

    assert!(result.is_err());
    assert_eq!(state.hostcalls, 2);
    let builder = state.builder(&resource(rep))?;
    assert!(builder.nodes.as_ref().is_some_and(Vec::is_empty));
    Ok(())
}

#[test]
fn builder_creation_rejects_untrusted_limits_before_operations() {
    let limits = Limits {
        max_string_bytes: u32::MAX,
        ..Limits::default()
    };
    assert!(state(limits).is_err());
}
