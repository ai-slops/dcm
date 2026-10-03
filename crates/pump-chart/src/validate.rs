use std::collections::BTreeSet;

use crate::{Limits, Music, Node, PANEL_MASK, Plan, ValidationError};

pub fn validate_music(music: &Music) -> Result<(), ValidationError> {
    if music.ticks_per_beat == 0 || music.duration_ticks == 0 {
        return Err(ValidationError::InvalidGrid);
    }
    if music.tempo.is_empty() || music.tempo[0].start_tick != 0 {
        return Err(ValidationError::InvalidTempo);
    }
    let mut previous = None;
    for segment in &music.tempo {
        if segment.start_tick >= music.duration_ticks
            || previous.is_some_and(|tick| tick >= segment.start_tick)
            || segment.micros_per_beat.numerator() == 0
            || crate::Fraction::new(
                segment.micros_per_beat.numerator(),
                segment.micros_per_beat.denominator(),
            )
            .map_err(|_| ValidationError::InvalidTempo)?
                != segment.micros_per_beat
        {
            return Err(ValidationError::InvalidTempo);
        }
        previous = Some(segment.start_tick);
    }
    if music
        .reference_accents
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
        || music
            .reference_accents
            .iter()
            .any(|tick| *tick >= music.duration_ticks)
    {
        return Err(ValidationError::InvalidAccents);
    }
    Ok(())
}

pub fn validate_plan(plan: &Plan, limits: &Limits) -> Result<(), ValidationError> {
    crate::validate_limits(limits)?;
    validate_music(&plan.music)?;
    if plan.nodes.is_empty() {
        return Err(ValidationError::EmptyComposite);
    }
    if plan.provenance.len() != plan.nodes.len() {
        return Err(ValidationError::LimitExceeded("provenance entries"));
    }
    if plan.nodes.len() > usize::try_from(limits.max_nodes).unwrap_or(usize::MAX) {
        return Err(ValidationError::LimitExceeded("nodes"));
    }
    if usize::try_from(plan.root).map_or(true, |root| root >= plan.nodes.len()) {
        return Err(ValidationError::ForwardReference);
    }
    let mut edges = 0_u64;
    let mut semantic_keys = BTreeSet::new();
    for (index, node) in plan.nodes.iter().enumerate() {
        let index = u32::try_from(index).map_err(|_| ValidationError::Overflow)?;
        let (children, key): (Vec<u32>, &str) = match node {
            Node::Tap { panel_mask, key } => {
                if *panel_mask == 0 || *panel_mask & !PANEL_MASK != 0 {
                    return Err(ValidationError::InvalidPanelMask(*panel_mask));
                }
                (Vec::new(), key)
            }
            Node::Hold {
                panel_mask,
                duration_ticks,
                key,
            } => {
                if *panel_mask == 0 || *panel_mask & !PANEL_MASK != 0 {
                    return Err(ValidationError::InvalidPanelMask(*panel_mask));
                }
                if *duration_ticks == 0 {
                    return Err(ValidationError::ZeroHold);
                }
                (Vec::new(), key)
            }
            Node::Rest {
                duration_ticks,
                key,
            } => {
                if *duration_ticks == 0 {
                    return Err(ValidationError::ZeroRest);
                }
                (Vec::new(), key)
            }
            Node::Sequence { children, key } | Node::Parallel { children, key } => {
                if children.is_empty() {
                    return Err(ValidationError::EmptyComposite);
                }
                (children.clone(), key)
            }
            Node::Repeat { child, count, key } => {
                if *count == 0 {
                    return Err(ValidationError::ZeroRepeat);
                }
                (vec![*child], key)
            }
            Node::Mirror { child, key } => (vec![*child], key),
            Node::Choice { branches, key } => {
                if branches.is_empty()
                    || branches.iter().any(|branch| {
                        branch.weight == 0
                            || branch.key.len()
                                > usize::try_from(limits.max_string_bytes).unwrap_or(usize::MAX)
                    })
                {
                    return Err(ValidationError::Overflow);
                }
                (branches.iter().map(|branch| branch.node).collect(), key)
            }
        };
        if key.len() > usize::try_from(limits.max_string_bytes).unwrap_or(usize::MAX) {
            return Err(ValidationError::LimitExceeded("string bytes"));
        }
        if key.is_empty() {
            return Err(ValidationError::EmptySemanticKey);
        }
        if !semantic_keys.insert(key) {
            return Err(ValidationError::DuplicateSemanticKey);
        }
        let provenance_index = usize::try_from(index).map_err(|_| ValidationError::Overflow)?;
        if plan.provenance[provenance_index].len()
            > usize::try_from(limits.max_string_bytes).unwrap_or(usize::MAX)
        {
            return Err(ValidationError::LimitExceeded("provenance bytes"));
        }
        if children.iter().any(|child| *child >= index) {
            return Err(ValidationError::ForwardReference);
        }
        edges = edges
            .checked_add(u64::try_from(children.len()).map_err(|_| ValidationError::Overflow)?)
            .ok_or(ValidationError::Overflow)?;
    }
    if edges > limits.max_edges {
        return Err(ValidationError::LimitExceeded("edges"));
    }
    Ok(())
}
