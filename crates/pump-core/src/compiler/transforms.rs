use crate::compiler::builder::{Builder, PendingNode, Prepare};
use crate::model::{Node, NodeId, PlanError, RelationKind, ScopeKind};

impl Builder {
    pub fn scope(
        &mut self,
        kind: ScopeKind,
        key: &str,
        child: NodeId,
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        if key.is_empty() {
            return Err(PlanError::OccurrenceKey);
        }
        let (duration, panels, expansion, child_depth) = self.metadata(child)?;
        let depth = child_depth.checked_add(1).ok_or(PlanError::Overflow)?;
        self.prepare(Prepare {
            id,
            source,
            extra_string: key.len(),
            depth,
            expansion,
            edges: 1,
        })?;
        self.commit(PendingNode {
            node: Node::Scope {
                kind,
                occurrence_key: key.to_owned(),
                child,
            },
            duration,
            panels,
            expansion,
            depth,
            id,
            source,
        })
    }

    pub fn mirror(&mut self, child: NodeId, id: &str, source: &str) -> Result<NodeId, PlanError> {
        let (duration, panels, expansion, child_depth) = self.metadata(child)?;
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
            node: Node::Mirror { child },
            duration,
            panels: super::mirror_mask(panels),
            expansion,
            depth,
            id,
            source,
        })
    }

    pub fn relation(
        &mut self,
        kind: RelationKind,
        left: NodeId,
        right: NodeId,
        id: &str,
        source: &str,
    ) -> Result<NodeId, PlanError> {
        let a = self.metadata(left)?;
        let b = self.metadata(right)?;
        let valid = match kind {
            RelationKind::Same => a.1 == b.1,
            RelationKind::Different => a.1 & b.1 == 0,
        };
        if !valid {
            return Err(PlanError::RelationViolation { kind });
        }
        let duration = a.0.checked_add(b.0).ok_or(PlanError::Overflow)?;
        let expansion = a.2.checked_add(b.2).ok_or(PlanError::Overflow)?;
        let depth = a.3.max(b.3).checked_add(1).ok_or(PlanError::Overflow)?;
        self.prepare(Prepare {
            id,
            source,
            extra_string: 0,
            depth,
            expansion,
            edges: 2,
        })?;
        self.commit(PendingNode {
            node: Node::Relation { kind, left, right },
            duration,
            panels: a.1 | b.1,
            expansion,
            depth,
            id,
            source,
        })
    }
}
