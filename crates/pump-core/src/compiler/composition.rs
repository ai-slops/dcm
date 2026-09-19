use crate::compiler::builder::{Builder, PendingNode, Prepare};
use crate::model::{Node, NodeId, PlanError, WeightedNode};

impl Builder {
    pub fn sequence(
        &mut self,
        children: &[NodeId],
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        self.composite(children, id, source, false)
    }

    pub fn parallel(
        &mut self,
        children: &[NodeId],
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        self.composite(children, id, source, true)
    }

    pub fn repeat(
        &mut self,
        child: NodeId,
        times: u32,
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        if times == 0 {
            return Err(PlanError::InvalidDuration);
        }
        let (child_duration, panels, child_expansion, child_depth) = self.metadata(child)?;
        let duration = child_duration
            .checked_mul(times)
            .ok_or(PlanError::Overflow)?;
        let expansion = child_expansion
            .checked_mul(times)
            .ok_or(PlanError::Overflow)?;
        let depth = child_depth.checked_add(1).ok_or(PlanError::Overflow)?;
        self.prepare(Prepare {
            id,
            source,
            extra_string: 0,
            depth,
            expansion,
            edges: 1,
        })?;
        self.commit(PendingNode {
            node: Node::Repeat { child, times },
            duration,
            panels,
            expansion,
            depth,
            id,
            source,
        })
    }

    pub fn choice(
        &mut self,
        alternatives: &[(u32, NodeId)],
        duration: Option<u32>,
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        if alternatives.is_empty() {
            return Err(PlanError::EmptyChildren);
        }
        self.ensure_edge_capacity(alternatives.len())?;
        let mut maximum = 0_u32;
        let mut expansion = 0_u32;
        let mut panels = 0_u16;
        let mut depth = 0_u32;
        let mut total_weight = 0_u64;
        for (weight, child) in alternatives {
            if *weight == 0 {
                return Err(PlanError::InvalidWeight);
            }
            total_weight = total_weight
                .checked_add(u64::from(*weight))
                .ok_or(PlanError::Overflow)?;
            let meta = self.metadata(*child)?;
            maximum = maximum.max(meta.0);
            expansion = expansion.max(meta.2);
            panels |= meta.1;
            depth = depth.max(meta.3);
        }
        if total_weight == 0 {
            return Err(PlanError::InvalidWeight);
        }
        let selected = duration.unwrap_or(maximum);
        let mut equal = true;
        for (_, child) in alternatives {
            equal &= self.metadata(*child)?.0 == selected;
        }
        if (!equal && duration.is_none()) || selected < maximum {
            return Err(PlanError::ChoiceDuration);
        }
        depth = depth.checked_add(1).ok_or(PlanError::Overflow)?;
        self.prepare(Prepare {
            id,
            source,
            extra_string: 0,
            depth,
            expansion,
            edges: alternatives.len(),
        })?;
        let values = alternatives
            .iter()
            .map(|(weight, node)| WeightedNode {
                weight: *weight,
                node: *node,
            })
            .collect();
        self.commit(PendingNode {
            node: Node::Choice {
                alternatives: values,
                duration: selected,
            },
            duration: selected,
            panels,
            expansion,
            depth,
            id,
            source,
        })
    }

    fn composite(
        &mut self,
        children: &[NodeId],
        id: &str,
        source: &str,
        parallel: bool,
    ) -> Result<NodeId, PlanError> {
        if children.is_empty() {
            return Err(PlanError::EmptyChildren);
        }
        self.ensure_edge_capacity(children.len())?;
        let mut duration = 0_u32;
        let mut expansion = 0_u32;
        let mut panels = 0_u16;
        let mut depth = 0_u32;
        for child in children {
            let meta = self.metadata(*child)?;
            if parallel && panels & meta.1 != 0 {
                return Err(PlanError::PanelCollision {
                    mask: panels & meta.1,
                });
            }
            duration = if parallel {
                duration.max(meta.0)
            } else {
                duration.checked_add(meta.0).ok_or(PlanError::Overflow)?
            };
            expansion = expansion.checked_add(meta.2).ok_or(PlanError::Overflow)?;
            panels |= meta.1;
            depth = depth.max(meta.3);
        }
        depth = depth.checked_add(1).ok_or(PlanError::Overflow)?;
        self.prepare(Prepare {
            id,
            source,
            extra_string: 0,
            depth,
            expansion,
            edges: children.len(),
        })?;
        let node = if parallel {
            Node::Parallel {
                children: children.to_vec(),
            }
        } else {
            Node::Sequence {
                children: children.to_vec(),
            }
        };
        self.commit(PendingNode {
            node,
            duration,
            panels,
            expansion,
            depth,
            id,
            source,
        })
    }
}
