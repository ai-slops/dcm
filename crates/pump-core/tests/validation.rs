use pump_core::{
    Builder, Limits, Node, PlanError, ScopeKind, WeightedNode, compile, decode_runtime_plan,
    encode_runtime_plan, generate,
};

fn one_tap_plan() -> Result<pump_core::Plan, PlanError> {
    let mut builder = Builder::new(Limits::default());
    let tap = builder.tap(1, 1, "tap", "source")?;
    builder.finish(tap)
}

#[test]
fn compile_rejects_forged_tap_semantics_and_metadata() {
    // Given
    let mut invalid_mask = one_tap_plan().expect("fixture");
    invalid_mask.nodes[0].node = Node::Tap {
        mask: 0,
        duration: 1,
    };
    let mut invalid_duration = one_tap_plan().expect("fixture");
    invalid_duration.nodes[0].node = Node::Tap {
        mask: 1,
        duration: 0,
    };
    let mut invalid_high_mask = one_tap_plan().expect("fixture");
    invalid_high_mask.nodes[0].node = Node::Tap {
        mask: 0x0400,
        duration: 1,
    };
    let mut forged_metadata = one_tap_plan().expect("fixture");
    forged_metadata.nodes[0].panel_union = 2;
    let mut forged_duration = one_tap_plan().expect("fixture");
    forged_duration.nodes[0].duration = 2;
    let mut forged_expansion = one_tap_plan().expect("fixture");
    forged_expansion.nodes[0].expansion = 2;

    // When / Then
    assert!(compile(&invalid_mask).is_err());
    assert!(compile(&invalid_duration).is_err());
    assert!(compile(&invalid_high_mask).is_err());
    assert!(compile(&forged_metadata).is_err());
    assert!(compile(&forged_duration).is_err());
    assert!(compile(&forged_expansion).is_err());
}

#[test]
fn compile_rejects_zero_repeat_weight_and_duplicate_id() {
    // Given
    let mut repeated = one_tap_plan().expect("fixture");
    let root = repeated.root;
    repeated.nodes.push(repeated.nodes[0].clone());
    repeated.nodes[1].decision_id = "repeat".to_owned();
    repeated.nodes[1].node = Node::Repeat {
        child: root,
        times: 0,
    };
    repeated.root = pump_core::NodeId(1);

    let mut weighted = one_tap_plan().expect("fixture");
    weighted.nodes.push(weighted.nodes[0].clone());
    weighted.nodes[1].decision_id = "choice".to_owned();
    weighted.nodes[1].node = Node::Choice {
        alternatives: vec![WeightedNode {
            weight: 0,
            node: root,
        }],
        duration: 1,
    };
    weighted.root = pump_core::NodeId(1);

    let mut duplicate = one_tap_plan().expect("fixture");
    duplicate.nodes.push(duplicate.nodes[0].clone());
    duplicate.nodes[1].node = Node::Mirror { child: root };
    duplicate.root = pump_core::NodeId(1);

    // When / Then
    assert!(compile(&repeated).is_err());
    assert!(compile(&weighted).is_err());
    assert!(compile(&duplicate).is_err());
}

#[test]
fn decoded_plan_rejects_forged_cached_metadata() {
    // Given
    let runtime = compile(&one_tap_plan().expect("fixture")).expect("compile");
    let mut bytes = encode_runtime_plan(&runtime).expect("encode");
    let metadata_offset = 4 + 2 + 4 + 4 + 4 + 4 + 3 + 4 + 6;
    let byte = bytes.get_mut(metadata_offset).expect("metadata byte");
    *byte ^= 1;

    // When
    let result = decode_runtime_plan(&bytes);

    // Then
    assert!(result.is_err());
}

#[test]
fn generate_rejects_publicly_forged_runtime_plan() {
    // Given
    let mut runtime = compile(&one_tap_plan().expect("fixture")).expect("compile");
    runtime.nodes[0].expansion = 0;

    // When
    let result = generate(&runtime, &[0; 32]);

    // Then
    assert!(result.is_err());
}

#[test]
fn valid_runtime_plan_roundtrips_and_generates() {
    // Given
    let runtime = compile(&one_tap_plan().expect("fixture")).expect("compile");

    // When
    let decoded =
        decode_runtime_plan(&encode_runtime_plan(&runtime).expect("encode")).expect("decode");
    let trace = generate(&decoded, &[3; 32]).expect("generate");

    // Then
    assert_eq!(decoded, runtime);
    assert_eq!(trace.commands.len(), 1);
    assert_eq!(trace.commands[0].panel_mask, 1);
}

#[test]
fn builder_rejects_string_child_and_total_edge_budgets_before_insertion() {
    // Given
    let mut strings = Builder::new(Limits::default());
    let huge_source = "x".repeat(1_048_577);
    let mut children = Builder::new(Limits::default());
    let tap = children.tap(1, 1, "tap", "source").expect("tap");
    let too_many_children = vec![(1, tap); 4097];
    let alternatives = vec![(1, tap); 4096];
    for index in 0..4 {
        children
            .choice(&alternatives, None, &format!("choice.{index}"), "source")
            .expect("within total edge budget");
    }

    // When
    let string_error = strings
        .tap(1, 1, "tap", &huge_source)
        .expect_err("string budget");
    let child_error = children
        .choice(&too_many_children, None, "too-many", "source")
        .expect_err("child budget");
    let edge_error = children
        .choice(&[(1, tap)], None, "over-total", "source")
        .expect_err("total edge budget");

    // Then
    assert!(matches!(string_error, PlanError::StringBudget { .. }));
    assert!(matches!(child_error, PlanError::EdgeBudget { limit: 4096 }));
    assert!(matches!(
        edge_error,
        PlanError::EdgeBudget { limit: 16_384 }
    ));
    assert_eq!(strings.node_count(), 0);
    assert_eq!(children.node_count(), 5);
}

#[test]
fn builder_enforces_depth_before_finish() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let mut node = builder.tap(1, 1, "tap", "source").expect("tap");

    // When
    let mut failure = None;
    for depth in 0..128 {
        match builder.scope(
            ScopeKind::Phrase,
            &format!("p{depth}"),
            node,
            &format!("scope.{depth}"),
            "source",
        ) {
            Ok(next) => node = next,
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
    }

    // Then
    assert!(matches!(
        failure,
        Some(PlanError::DepthBudget { limit: 128 })
    ));
}

#[test]
fn forged_shared_dag_is_rejected_without_path_enumeration() {
    // Given
    let mut plan = one_tap_plan().expect("fixture");
    let mut node = plan.root;
    for level in 0..22 {
        let mut entry = plan.nodes[0].clone();
        entry.decision_id = format!("fork.{level}");
        entry.node = Node::Sequence {
            children: vec![node, node],
        };
        entry.duration = 1;
        entry.expansion = 1;
        plan.nodes.push(entry);
        node = pump_core::NodeId(u32::try_from(plan.nodes.len() - 1).expect("node id"));
    }
    plan.root = node;

    // When
    let result = compile(&plan);

    // Then
    assert!(result.is_err());
}
