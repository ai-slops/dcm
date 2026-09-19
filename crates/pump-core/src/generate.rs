use sha2::{Digest, Sha256};

use crate::codec::encode_runtime_plan;
use crate::compiler::{mirror_mask, validate_runtime_plan};
use crate::model::{Command, CommandTrace, Node, NodeId, PlanError, RuntimePlan, ScopeKind};
use crate::{FORMAT_VERSION, sample_weighted};

pub fn generate(plan: &RuntimePlan, seed: &[u8]) -> Result<CommandTrace, PlanError> {
    if seed.len() != 32 {
        return Err(PlanError::InvalidSeed);
    }
    let plan = validate_runtime_plan(plan)?;
    let mut context = Context {
        plan: &plan,
        seed,
        occurrence: Vec::new(),
        commands: Vec::new(),
    };
    context.emit(plan.root, 0, false)?;
    context.commands.sort_by(|a, b| {
        (a.tick, a.panel_mask, &a.decision_id).cmp(&(b.tick, b.panel_mask, &b.decision_id))
    });
    let plan_digest = hex::encode(Sha256::digest(encode_runtime_plan(&plan)?));
    let seed_digest = hex::encode(Sha256::digest(seed));
    let duration = context.entry(plan.root)?.duration;
    Ok(CommandTrace {
        version: FORMAT_VERSION,
        plan_digest,
        seed_digest,
        duration,
        commands: context.commands,
    })
}

struct Context<'a> {
    plan: &'a RuntimePlan,
    seed: &'a [u8],
    occurrence: Vec<String>,
    commands: Vec<Command>,
}

impl Context<'_> {
    fn emit(&mut self, id: NodeId, start: u32, mirrored: bool) -> Result<(), PlanError> {
        if self.commands.len()
            >= usize::try_from(self.plan.max_trace).map_err(|_| PlanError::Overflow)?
        {
            return Err(PlanError::TraceBudget {
                limit: self.plan.max_trace,
            });
        }
        let entry = self.entry(id)?.clone();
        match entry.node {
            Node::Tap { mask, duration } => self.commands.push(Command {
                tick: start,
                duration,
                panel_mask: if mirrored { mirror_mask(mask) } else { mask },
                decision_id: entry.decision_id,
                provenance: entry.provenance,
            }),
            Node::Sequence { children } => {
                let mut tick = start;
                for child in children {
                    self.emit(child, tick, mirrored)?;
                    tick = tick
                        .checked_add(self.entry(child)?.duration)
                        .ok_or(PlanError::Overflow)?;
                }
            }
            Node::Parallel { children } => {
                for child in children {
                    self.emit(child, start, mirrored)?;
                }
            }
            Node::Repeat { child, times } => {
                for index in 0..times {
                    self.occurrence
                        .push(format!("{}#{index}", entry.decision_id));
                    let offset = self
                        .entry(child)?
                        .duration
                        .checked_mul(index)
                        .ok_or(PlanError::Overflow)?;
                    self.emit(
                        child,
                        start.checked_add(offset).ok_or(PlanError::Overflow)?,
                        mirrored,
                    )?;
                    self.occurrence.pop();
                }
            }
            Node::Choice { alternatives, .. } => {
                let weights: Vec<u32> = alternatives.iter().map(|item| item.weight).collect();
                let paths: Vec<&str> = self.occurrence.iter().map(String::as_str).collect();
                let selected = sample_weighted(self.seed, &entry.decision_id, &paths, &weights)?;
                let child = alternatives.get(selected).ok_or(PlanError::Overflow)?.node;
                self.emit(child, start, mirrored)?;
            }
            Node::Scope {
                kind,
                occurrence_key,
                child,
            } => {
                self.occurrence
                    .push(format!("{}:{occurrence_key}", scope_name(kind)));
                self.emit(child, start, mirrored)?;
                self.occurrence.pop();
            }
            Node::Mirror { child } => self.emit(child, start, !mirrored)?,
            Node::Relation { left, right, .. } => {
                self.emit(left, start, mirrored)?;
                let next = start
                    .checked_add(self.entry(left)?.duration)
                    .ok_or(PlanError::Overflow)?;
                self.emit(right, next, mirrored)?;
            }
        }
        Ok(())
    }

    fn entry(&self, id: NodeId) -> Result<&crate::model::PlanNode, PlanError> {
        self.plan
            .nodes
            .get(usize::try_from(id.0).map_err(|_| PlanError::Overflow)?)
            .ok_or(PlanError::ForwardReference {
                referenced: id.0,
                next: u32::try_from(self.plan.nodes.len()).map_err(|_| PlanError::Overflow)?,
            })
    }
}

const fn scope_name(kind: ScopeKind) -> &'static str {
    match kind {
        ScopeKind::Run => "run",
        ScopeKind::Section => "section",
        ScopeKind::Phrase => "phrase",
    }
}
