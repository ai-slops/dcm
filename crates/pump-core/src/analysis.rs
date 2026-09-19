use serde::{Deserialize, Serialize};

use crate::compiler::validate_runtime_plan;
use crate::model::{Node, PlanError, RuntimePlan};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Analysis {
    pub node_count: usize,
    pub root_expansion_bound: u32,
    pub root_duration_ticks: u32,
    pub declared_tap_node_count: u32,
    pub declared_choice_node_count: u32,
    pub provenance_sites: u32,
    pub max_declared_tap_mask_width: u32,
}

pub fn analyze(plan: &RuntimePlan) -> Result<Analysis, PlanError> {
    let plan = validate_runtime_plan(plan)?;
    let root = plan
        .nodes
        .get(usize::try_from(plan.root.0).map_err(|_| PlanError::Overflow)?)
        .ok_or(PlanError::InvalidFormat("root"))?;
    let mut tap_sites = 0_u32;
    let mut choice_sites = 0_u32;
    let mut intent = 0_u32;
    let mut maximum_panels = 0_u32;
    for entry in &plan.nodes {
        if !entry.provenance.is_empty() {
            intent = intent.checked_add(1).ok_or(PlanError::Overflow)?;
        }
        match &entry.node {
            Node::Tap { mask, .. } => {
                tap_sites = tap_sites.checked_add(1).ok_or(PlanError::Overflow)?;
                maximum_panels = maximum_panels.max(mask.count_ones());
            }
            Node::Choice { .. } => {
                choice_sites = choice_sites.checked_add(1).ok_or(PlanError::Overflow)?;
            }
            Node::Sequence { .. }
            | Node::Parallel { .. }
            | Node::Repeat { .. }
            | Node::Scope { .. }
            | Node::Mirror { .. }
            | Node::Relation { .. } => {}
        }
    }
    Ok(Analysis {
        node_count: plan.nodes.len(),
        root_expansion_bound: root.expansion,
        root_duration_ticks: root.duration,
        declared_tap_node_count: tap_sites,
        declared_choice_node_count: choice_sites,
        provenance_sites: intent,
        max_declared_tap_mask_width: maximum_panels,
    })
}
