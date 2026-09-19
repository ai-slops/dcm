use crate::FORMAT_VERSION;
use crate::codec::io::{Reader, length, put_ids, put_string, put_u16, put_u32, take_edges};
use crate::compiler::validate_runtime_plan;
use crate::model::{
    Node, NodeId, PlanError, PlanNode, RelationKind, RuntimePlan, ScopeKind, WeightedNode,
};

const MAGIC: &[u8; 4] = b"PRTP";

pub fn encode_runtime_plan(plan: &RuntimePlan) -> Result<Vec<u8>, PlanError> {
    let plan = validate_runtime_plan(plan)?;
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    put_u16(&mut out, FORMAT_VERSION);
    put_u32(&mut out, plan.max_trace);
    put_u32(&mut out, plan.root.0);
    put_u32(&mut out, length(plan.nodes.len())?);
    for entry in &plan.nodes {
        put_string(&mut out, &entry.decision_id)?;
        put_string(&mut out, &entry.provenance)?;
        put_u32(&mut out, entry.duration);
        put_u16(&mut out, entry.panel_union);
        put_u32(&mut out, entry.expansion);
        encode_node(&mut out, &entry.node)?;
    }
    Ok(out)
}

pub fn decode_runtime_plan(bytes: &[u8]) -> Result<RuntimePlan, PlanError> {
    let mut reader = Reader::new(bytes, 1_048_576);
    if reader.take(4)? != MAGIC {
        return Err(PlanError::InvalidFormat("plan magic"));
    }
    let version = reader.u16()?;
    if version != FORMAT_VERSION {
        return Err(PlanError::UnsupportedVersion(version));
    }
    let max_trace = reader.u32()?;
    let root = NodeId(reader.u32()?);
    let count = reader.u32()?;
    if count == 0 || count > 4096 {
        return Err(PlanError::NodeBudget { limit: 4096 });
    }
    let mut nodes = Vec::with_capacity(usize::try_from(count).map_err(|_| PlanError::Overflow)?);
    let mut edges = 16_384;
    for next in 0..count {
        nodes.push(PlanNode {
            decision_id: reader.string()?,
            provenance: reader.string()?,
            duration: reader.u32()?,
            panel_union: reader.u16()?,
            expansion: reader.u32()?,
            node: decode_node(&mut reader, next, &mut edges)?,
        });
    }
    if reader.remaining() != 0 {
        return Err(PlanError::InvalidFormat("trailing plan bytes"));
    }
    if root.0 >= count {
        return Err(PlanError::ForwardReference {
            referenced: root.0,
            next: count,
        });
    }
    validate_runtime_plan(&RuntimePlan {
        nodes,
        root,
        max_trace,
    })
}

fn encode_node(out: &mut Vec<u8>, node: &Node) -> Result<(), PlanError> {
    match node {
        Node::Tap { mask, duration } => {
            out.push(0);
            put_u16(out, *mask);
            put_u32(out, *duration);
        }
        Node::Sequence { children } => {
            out.push(1);
            put_ids(out, children)?;
        }
        Node::Parallel { children } => {
            out.push(2);
            put_ids(out, children)?;
        }
        Node::Repeat { child, times } => {
            out.push(3);
            put_u32(out, child.0);
            put_u32(out, *times);
        }
        Node::Choice {
            alternatives,
            duration,
        } => {
            out.push(4);
            put_u32(out, *duration);
            put_u32(out, length(alternatives.len())?);
            for alternative in alternatives {
                put_u32(out, alternative.weight);
                put_u32(out, alternative.node.0);
            }
        }
        Node::Scope {
            kind,
            occurrence_key,
            child,
        } => {
            out.push(5);
            out.push(scope_tag(*kind));
            put_string(out, occurrence_key)?;
            put_u32(out, child.0);
        }
        Node::Mirror { child } => {
            out.push(6);
            put_u32(out, child.0);
        }
        Node::Relation { kind, left, right } => {
            out.push(7);
            out.push(relation_tag(*kind));
            put_u32(out, left.0);
            put_u32(out, right.0);
        }
    }
    Ok(())
}

fn decode_node(reader: &mut Reader<'_>, next: u32, edges: &mut u32) -> Result<Node, PlanError> {
    match reader.byte()? {
        0 => Ok(Node::Tap {
            mask: reader.u16()?,
            duration: reader.u32()?,
        }),
        1 => Ok(Node::Sequence {
            children: reader.ids(next, edges)?,
        }),
        2 => Ok(Node::Parallel {
            children: reader.ids(next, edges)?,
        }),
        3 => {
            take_edges(edges, 1)?;
            Ok(Node::Repeat {
                child: reader.id(next)?,
                times: reader.u32()?,
            })
        }
        4 => decode_choice(reader, next, edges),
        5 => {
            take_edges(edges, 1)?;
            Ok(Node::Scope {
                kind: decode_scope(reader.byte()?)?,
                occurrence_key: reader.string()?,
                child: reader.id(next)?,
            })
        }
        6 => {
            take_edges(edges, 1)?;
            Ok(Node::Mirror {
                child: reader.id(next)?,
            })
        }
        7 => {
            take_edges(edges, 2)?;
            Ok(Node::Relation {
                kind: decode_relation(reader.byte()?)?,
                left: reader.id(next)?,
                right: reader.id(next)?,
            })
        }
        _ => Err(PlanError::InvalidFormat("node tag")),
    }
}

fn decode_choice(reader: &mut Reader<'_>, next: u32, edges: &mut u32) -> Result<Node, PlanError> {
    let duration = reader.u32()?;
    let count = reader.u32()?;
    if count == 0 || count > 4096 {
        return Err(PlanError::InvalidFormat("choice count"));
    }
    take_edges(edges, count)?;
    let mut alternatives =
        Vec::with_capacity(usize::try_from(count).map_err(|_| PlanError::Overflow)?);
    for _ in 0..count {
        alternatives.push(WeightedNode {
            weight: reader.u32()?,
            node: reader.id(next)?,
        });
    }
    Ok(Node::Choice {
        alternatives,
        duration,
    })
}

const fn scope_tag(kind: ScopeKind) -> u8 {
    match kind {
        ScopeKind::Run => 0,
        ScopeKind::Section => 1,
        ScopeKind::Phrase => 2,
    }
}
const fn relation_tag(kind: RelationKind) -> u8 {
    match kind {
        RelationKind::Same => 0,
        RelationKind::Different => 1,
    }
}
const fn decode_scope(tag: u8) -> Result<ScopeKind, PlanError> {
    match tag {
        0 => Ok(ScopeKind::Run),
        1 => Ok(ScopeKind::Section),
        2 => Ok(ScopeKind::Phrase),
        _ => Err(PlanError::InvalidFormat("scope tag")),
    }
}
const fn decode_relation(tag: u8) -> Result<RelationKind, PlanError> {
    match tag {
        0 => Ok(RelationKind::Same),
        1 => Ok(RelationKind::Different),
        _ => Err(PlanError::InvalidFormat("relation tag")),
    }
}
