use std::collections::BTreeSet;

use crate::PANEL_MASK;
use crate::model::{Node, NodeId, Plan, PlanError, PlanNode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_nodes: u32,
    pub max_depth: u32,
    pub max_trace: u32,
    pub max_expansions: u32,
    pub max_edges: u32,
    pub max_string_bytes: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_nodes: 4096,
            max_depth: 128,
            max_trace: 10_000,
            max_expansions: 10_000,
            max_edges: 16_384,
            max_string_bytes: 1_048_576,
        }
    }
}

#[derive(Debug)]
pub struct Builder {
    pub(super) limits: Limits,
    pub(super) nodes: Vec<PlanNode>,
    depths: Vec<u32>,
    ids: BTreeSet<String>,
    edges: u32,
    string_bytes: u32,
}

impl Builder {
    pub fn new(requested: Limits) -> Self {
        let hard = Limits::default();
        let limits = Limits {
            max_nodes: requested.max_nodes.min(hard.max_nodes),
            max_depth: requested.max_depth.min(hard.max_depth),
            max_trace: requested.max_trace.min(hard.max_trace),
            max_expansions: requested.max_expansions.min(hard.max_expansions),
            max_edges: requested.max_edges.min(hard.max_edges),
            max_string_bytes: requested.max_string_bytes.min(hard.max_string_bytes),
        };
        Self {
            limits,
            nodes: Vec::new(),
            depths: Vec::new(),
            ids: BTreeSet::new(),
            edges: 0,
            string_bytes: 0,
        }
    }

    pub const fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn tap(
        &mut self,
        mask: u16,
        duration: u32,
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        if mask == 0 || mask & !PANEL_MASK != 0 {
            return Err(PlanError::InvalidPanelMask(mask));
        }
        if duration == 0 {
            return Err(PlanError::InvalidDuration);
        }
        self.prepare(Prepare {
            id,
            source,
            extra_string: 0,
            depth: 1,
            expansion: 1,
            edges: 0,
        })?;
        self.commit(PendingNode {
            node: Node::Tap { mask, duration },
            duration,
            panels: mask,
            expansion: 1,
            depth: 1,
            id,
            source,
        })
    }

    pub fn finish(self, root: NodeId) -> Result<Plan, PlanError> {
        self.metadata(root)?;
        Ok(Plan {
            nodes: self.nodes,
            root,
        })
    }

    pub(super) fn metadata(&self, id: NodeId) -> Result<(u32, u16, u32, u32), PlanError> {
        let index = usize::try_from(id.0).map_err(|_| PlanError::Overflow)?;
        let node = self.nodes.get(index).ok_or(PlanError::ForwardReference {
            referenced: id.0,
            next: u32::try_from(self.nodes.len()).map_err(|_| PlanError::Overflow)?,
        })?;
        let depth = *self
            .depths
            .get(index)
            .ok_or(PlanError::InvalidFormat("depth metadata"))?;
        Ok((node.duration, node.panel_union, node.expansion, depth))
    }

    pub(super) fn prepare(&self, request: Prepare<'_>) -> Result<(), PlanError> {
        if request.id.len() > crate::MAX_STRING_BYTES
            || request.source.len() > crate::MAX_STRING_BYTES
            || request.extra_string > crate::MAX_STRING_BYTES
        {
            return Err(PlanError::StringBudget { limit: 256 });
        }
        let next = u32::try_from(self.nodes.len()).map_err(|_| PlanError::Overflow)?;
        if next >= self.limits.max_nodes {
            return Err(PlanError::NodeBudget {
                limit: self.limits.max_nodes,
            });
        }
        if request.depth > self.limits.max_depth {
            return Err(PlanError::DepthBudget {
                limit: self.limits.max_depth,
            });
        }
        if request.expansion > self.limits.max_expansions
            || request.expansion > self.limits.max_trace
        {
            return Err(PlanError::ExpansionBudget {
                limit: self.limits.max_expansions.min(self.limits.max_trace),
            });
        }
        if request.id.is_empty() || self.ids.contains(request.id) {
            return Err(PlanError::DecisionId(request.id.to_owned()));
        }
        self.ensure_edge_capacity(request.edges)?;
        let added = request
            .id
            .len()
            .checked_add(request.source.len())
            .and_then(|size| size.checked_add(request.extra_string))
            .ok_or(PlanError::Overflow)?;
        let strings = self
            .string_bytes
            .checked_add(u32::try_from(added).map_err(|_| PlanError::Overflow)?)
            .ok_or(PlanError::Overflow)?;
        if strings > self.limits.max_string_bytes {
            return Err(PlanError::StringBudget {
                limit: self.limits.max_string_bytes,
            });
        }
        Ok(())
    }

    pub(super) fn ensure_edge_capacity(&self, edges: usize) -> Result<(), PlanError> {
        let added = u32::try_from(edges).map_err(|_| PlanError::Overflow)?;
        if added > self.limits.max_nodes {
            return Err(PlanError::EdgeBudget {
                limit: self.limits.max_nodes,
            });
        }
        let total = self.edges.checked_add(added).ok_or(PlanError::Overflow)?;
        if total > self.limits.max_edges {
            return Err(PlanError::EdgeBudget {
                limit: self.limits.max_edges,
            });
        }
        Ok(())
    }

    pub(super) fn commit(&mut self, entry: PendingNode<'_>) -> Result<NodeId, PlanError> {
        let next = u32::try_from(self.nodes.len()).map_err(|_| PlanError::Overflow)?;
        self.edges = self
            .edges
            .checked_add(u32::try_from(edge_count(&entry.node)).map_err(|_| PlanError::Overflow)?)
            .ok_or(PlanError::Overflow)?;
        let size = entry
            .id
            .len()
            .checked_add(entry.source.len())
            .and_then(|value| value.checked_add(scope_bytes(&entry.node)))
            .ok_or(PlanError::Overflow)?;
        self.string_bytes = self
            .string_bytes
            .checked_add(u32::try_from(size).map_err(|_| PlanError::Overflow)?)
            .ok_or(PlanError::Overflow)?;
        self.ids.insert(entry.id.to_owned());
        self.depths.push(entry.depth);
        self.nodes.push(PlanNode {
            decision_id: entry.id.to_owned(),
            provenance: entry.source.to_owned(),
            duration: entry.duration,
            panel_union: entry.panels,
            expansion: entry.expansion,
            node: entry.node,
        });
        Ok(NodeId(next))
    }
}

pub(super) struct Prepare<'a> {
    pub id: &'a str,
    pub source: &'a str,
    pub extra_string: usize,
    pub depth: u32,
    pub expansion: u32,
    pub edges: usize,
}

pub(super) struct PendingNode<'a> {
    pub node: Node,
    pub duration: u32,
    pub panels: u16,
    pub expansion: u32,
    pub depth: u32,
    pub id: &'a str,
    pub source: &'a str,
}

fn edge_count(node: &Node) -> usize {
    match node {
        Node::Tap { .. } => 0,
        Node::Sequence { children } | Node::Parallel { children } => children.len(),
        Node::Repeat { .. } | Node::Scope { .. } | Node::Mirror { .. } => 1,
        Node::Choice { alternatives, .. } => alternatives.len(),
        Node::Relation { .. } => 2,
    }
}

fn scope_bytes(node: &Node) -> usize {
    match node {
        Node::Scope { occurrence_key, .. } => occurrence_key.len(),
        Node::Tap { .. }
        | Node::Sequence { .. }
        | Node::Parallel { .. }
        | Node::Repeat { .. }
        | Node::Choice { .. }
        | Node::Mirror { .. }
        | Node::Relation { .. } => 0,
    }
}
