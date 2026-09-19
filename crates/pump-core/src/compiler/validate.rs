use crate::compiler::{Builder, Limits};
use crate::model::{Node, NodeId, Plan, PlanError, PlanNode, RuntimePlan};

pub fn compile(plan: &Plan) -> Result<RuntimePlan, PlanError> {
    let rebuilt = rebuild(plan)?;
    if &rebuilt != plan {
        return Err(PlanError::NonCanonical("plan metadata"));
    }
    Ok(RuntimePlan {
        nodes: rebuilt.nodes,
        root: rebuilt.root,
        max_trace: Limits::default().max_trace,
    })
}

pub fn validate_runtime_plan(plan: &RuntimePlan) -> Result<RuntimePlan, PlanError> {
    if plan.max_trace != Limits::default().max_trace {
        return Err(PlanError::NonCanonical("runtime trace limit"));
    }
    let validated = compile(&Plan {
        nodes: plan.nodes.clone(),
        root: plan.root,
    })?;
    if &validated != plan {
        return Err(PlanError::NonCanonical("runtime plan"));
    }
    Ok(validated)
}

fn rebuild(plan: &Plan) -> Result<Plan, PlanError> {
    let mut builder = Builder::new(Limits::default());
    for entry in &plan.nodes {
        replay(&mut builder, entry)?;
    }
    builder.finish(plan.root)
}

fn replay(builder: &mut Builder, entry: &PlanNode) -> Result<NodeId, PlanError> {
    let id = &entry.decision_id;
    let source = &entry.provenance;
    match &entry.node {
        Node::Tap { mask, duration } => builder.tap(*mask, *duration, id, source),
        Node::Sequence { children } => builder.sequence(children, id, source),
        Node::Parallel { children } => builder.parallel(children, id, source),
        Node::Repeat { child, times } => builder.repeat(*child, *times, id, source),
        Node::Choice {
            alternatives,
            duration,
        } => {
            let values: Vec<(u32, NodeId)> = alternatives
                .iter()
                .map(|item| (item.weight, item.node))
                .collect();
            builder.choice(&values, Some(*duration), id, source)
        }
        Node::Scope {
            kind,
            occurrence_key,
            child,
        } => builder.scope(*kind, occurrence_key, *child, id, source),
        Node::Mirror { child } => builder.mirror(*child, id, source),
        Node::Relation { kind, left, right } => builder.relation(*kind, *left, *right, id, source),
    }
}

pub const fn mirror_mask(mask: u16) -> u16 {
    let mut source = mask;
    let mut target = 0_u16;
    let mut index = 0_u8;
    while index < 10 {
        if source & 1 == 1 {
            target |= 1 << (9 - index);
        }
        source >>= 1;
        index += 1;
    }
    target
}
