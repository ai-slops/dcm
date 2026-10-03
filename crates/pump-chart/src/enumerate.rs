use crate::{
    Chart, Decision, Derivation, EnumerateError, Enumeration, Fraction, Limits, Node, NodeId, Note,
    Plan, ValidationError, normalize_chart, validate_plan,
};

#[derive(Clone)]
pub(crate) struct Trace {
    pub(crate) span: u64,
    pub(crate) notes: Vec<Note>,
    pub(crate) mass: Fraction,
    pub(crate) decisions: Vec<Decision>,
}

pub(crate) struct Context<'a> {
    pub(crate) plan: &'a Plan,
    pub(crate) limits: &'a Limits,
    pub(crate) work: u64,
    pub(crate) events: u64,
}

pub fn enumerate(plan: &Plan, limits: &Limits) -> Result<Enumeration, EnumerateError> {
    if limits.max_derivations == 0 || limits.max_derivations > crate::MAX_DERIVATIONS {
        return Err(EnumerateError::LimitExceeded("max_derivations"));
    }
    validate_plan(plan, limits).map_err(|error| EnumerateError::InvalidPlan(error.to_string()))?;
    let mut context = Context {
        plan,
        limits,
        work: 0,
        events: 0,
    };
    let traces = context.expand(plan.root, 1)?;
    let mut derivations = Vec::with_capacity(traces.len());
    let mut total_prior_mass = Fraction::ZERO;
    for mut trace in traces {
        if trace.span > plan.music.duration_ticks {
            return Err(EnumerateError::Chart(ValidationError::NoteOutsideSpan));
        }
        for (occurrence, decision) in trace.decisions.iter_mut().enumerate() {
            decision.occurrence = u64::try_from(occurrence)
                .map_err(|_| EnumerateError::LimitExceeded("decision occurrence"))?;
        }
        let chart = normalize_chart(&Chart {
            ticks_per_beat: plan.music.ticks_per_beat,
            span_ticks: plan.music.duration_ticks,
            notes: trace.notes,
        })?;
        total_prior_mass = total_prior_mass.checked_add(trace.mass)?;
        derivations.push(Derivation {
            chart,
            prior_mass: trace.mass,
            decisions: trace.decisions,
        });
    }
    Ok(Enumeration {
        derivations,
        total_prior_mass,
        work: context.work,
    })
}

impl Context<'_> {
    fn expand(&mut self, node_id: NodeId, depth: u32) -> Result<Vec<Trace>, EnumerateError> {
        if depth > self.limits.max_depth {
            return Err(EnumerateError::LimitExceeded("depth"));
        }
        self.add_work(1)?;
        let index = usize::try_from(node_id)
            .map_err(|_| EnumerateError::InvalidPlan("node index".into()))?;
        let node = self
            .plan
            .nodes
            .get(index)
            .ok_or_else(|| EnumerateError::InvalidPlan("node index".into()))?;
        match node {
            Node::Tap { panel_mask, .. } => {
                self.single(0, vec![crate::chart::note(0, *panel_mask, 0)])
            }
            Node::Hold {
                panel_mask,
                duration_ticks,
                ..
            } => {
                if *duration_ticks == 0 {
                    return Err(EnumerateError::InvalidPlan("zero hold".into()));
                }
                self.single(
                    *duration_ticks,
                    vec![crate::chart::note(0, *panel_mask, *duration_ticks)],
                )
            }
            Node::Rest { duration_ticks, .. } => self.single(*duration_ticks, Vec::new()),
            Node::Sequence { children, .. } => self.expand_sequence(children, depth),
            Node::Parallel { children, .. } => self.expand_parallel(children, depth),
            Node::Repeat { child, count, .. } => {
                if *count == 0 {
                    return Err(EnumerateError::InvalidPlan("zero repeat".into()));
                }
                self.expand_repeat(*child, *count, depth)
            }
            Node::Choice { branches, .. } => {
                let total = branches.iter().try_fold(0_u128, |sum, branch| {
                    sum.checked_add(branch.weight)
                        .ok_or(EnumerateError::LimitExceeded("choice weight"))
                })?;
                let mut output = Vec::new();
                for (branch_index, branch) in branches.iter().enumerate() {
                    let probability = Fraction::new(branch.weight, total)?;
                    for mut trace in self.expand(branch.node, depth + 1)? {
                        trace.mass = trace.mass.checked_mul(probability)?;
                        trace.decisions.insert(
                            0,
                            Decision {
                                node: node_id,
                                occurrence: 0,
                                branch: u32::try_from(branch_index)
                                    .map_err(|_| EnumerateError::LimitExceeded("branch index"))?,
                                semantic_key: branch.key.clone(),
                                provenance: self.plan.provenance[index].clone(),
                            },
                        );
                        output.push(trace);
                        self.check_derivations(output.len())?;
                    }
                }
                Ok(output)
            }
            Node::Mirror { child, .. } => {
                let mut traces = self.expand(*child, depth + 1)?;
                for trace in &mut traces {
                    for note in &mut trace.notes {
                        note.panel_mask = mirror_mask(note.panel_mask);
                    }
                }
                Ok(traces)
            }
        }
    }

    fn single(&mut self, span: u64, notes: Vec<Note>) -> Result<Vec<Trace>, EnumerateError> {
        self.add_events(notes.len())?;
        Ok(vec![Trace {
            span,
            notes,
            mass: Fraction::ONE,
            decisions: Vec::new(),
        }])
    }

    fn expand_sequence(
        &mut self,
        children: &[NodeId],
        depth: u32,
    ) -> Result<Vec<Trace>, EnumerateError> {
        let mut output = vec![Trace {
            span: 0,
            notes: Vec::new(),
            mass: Fraction::ONE,
            decisions: Vec::new(),
        }];
        for child in children {
            let right = self.expand(*child, depth + 1)?;
            output = self.combine(&output, &right, true)?;
        }
        Ok(output)
    }

    fn expand_parallel(
        &mut self,
        children: &[NodeId],
        depth: u32,
    ) -> Result<Vec<Trace>, EnumerateError> {
        let mut output = vec![Trace {
            span: 0,
            notes: Vec::new(),
            mass: Fraction::ONE,
            decisions: Vec::new(),
        }];
        for child in children {
            let right = self.expand(*child, depth + 1)?;
            output = self.combine(&output, &right, false)?;
        }
        Ok(output)
    }

    fn expand_repeat(
        &mut self,
        child: NodeId,
        count: u32,
        depth: u32,
    ) -> Result<Vec<Trace>, EnumerateError> {
        let remaining_work = self.limits.max_work.saturating_sub(self.work);
        if u64::from(count) > remaining_work {
            return Err(EnumerateError::LimitExceeded("repeat count"));
        }
        let mut output = vec![Trace {
            span: 0,
            notes: Vec::new(),
            mass: Fraction::ONE,
            decisions: Vec::new(),
        }];
        for _ in 0..count {
            let right = self.expand(child, depth + 1)?;
            output = self.combine(&output, &right, true)?;
        }
        Ok(output)
    }
}

fn mirror_mask(mask: u16) -> u16 {
    let mut output = 0_u16;
    for (source, target) in crate::MIRROR_PANEL_MAP.into_iter().enumerate() {
        if mask & (1_u16 << source) != 0 {
            output |= 1_u16 << target;
        }
    }
    output
}
