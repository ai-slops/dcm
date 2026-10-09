use sha2::{Digest, Sha256};

use pump_chart::{HistoryPolicy, Limits, Node, Plan, WeightedChart, WeightedNode};

use crate::{ADAPTER_VERSION, BridgeError, BridgeStatistics, Conversion};

pub(crate) fn lower(
    music: &pump_chart::Music,
    limits: &Limits,
    source_bytes: &[u8],
    charts: Vec<WeightedChart>,
    mut statistics: BridgeStatistics,
) -> Result<Conversion, BridgeError> {
    let runtime = pump_chart::build_runtime(
        music.clone(),
        &charts,
        HistoryPolicy {
            recent_window: 0,
            max_request_history: 0,
        },
    )?;
    statistics.unique_charts =
        u32::try_from(runtime.candidates.len()).map_err(|_| BridgeError::ArithmeticOverflow)?;
    if runtime.original_mass != pump_chart::Fraction::ONE {
        return Err(BridgeError::ArithmeticOverflow);
    }
    let source_digest = hex::encode(Sha256::digest(source_bytes));
    reserve_graph(&runtime.candidates, limits)?;
    let mut nodes = Vec::new();
    let mut provenance = Vec::new();
    let mut branches = Vec::with_capacity(runtime.candidates.len());
    for candidate in &runtime.candidates {
        let candidate_id = hex::encode(candidate.id.0);
        let prefix = format!("{ADAPTER_VERSION}:{source_digest}:{candidate_id}");
        let mut children = Vec::new();
        let mut cursor = 0_u64;
        for (index, note) in candidate.chart.notes.iter().enumerate() {
            if note.tick > cursor {
                children.push(push_node(
                    &mut nodes,
                    &mut provenance,
                    Node::Rest {
                        duration_ticks: note.tick - cursor,
                        key: format!("{prefix}:r{index}"),
                    },
                    format!("{prefix}:rest:{index}"),
                )?);
            }
            children.push(push_node(
                &mut nodes,
                &mut provenance,
                Node::Tap {
                    panel_mask: note.panel_mask,
                    key: format!("{prefix}:t{index}"),
                },
                format!("{prefix}:tap:{index}"),
            )?);
            cursor = note.tick;
        }
        if cursor < music.duration_ticks {
            let index = candidate.chart.notes.len();
            children.push(push_node(
                &mut nodes,
                &mut provenance,
                Node::Rest {
                    duration_ticks: music.duration_ticks - cursor,
                    key: format!("{prefix}:r{index}"),
                },
                format!("{prefix}:rest:{index}"),
            )?);
        }
        let branch = push_node(
            &mut nodes,
            &mut provenance,
            Node::Sequence {
                children,
                key: format!("{prefix}:seq"),
            },
            format!("{prefix}:sequence"),
        )?;
        branches.push(WeightedNode {
            node: branch,
            weight: candidate.weight,
            key: format!("{prefix}:candidate"),
        });
    }
    let root = push_node(
        &mut nodes,
        &mut provenance,
        Node::Choice {
            branches,
            key: format!("{ADAPTER_VERSION}:{source_digest}:root"),
        },
        format!("{ADAPTER_VERSION}:{source_digest}:root"),
    )?;
    let plan = Plan {
        music: music.clone(),
        nodes,
        provenance,
        root,
    };
    pump_chart::validate_plan(&plan, limits)?;
    let _encoded = pump_chart::encode_plan_with_limits(&plan, limits)?;
    Ok(Conversion { plan, statistics })
}

fn reserve_graph(candidates: &[pump_chart::Candidate], limits: &Limits) -> Result<(), BridgeError> {
    if limits.max_depth < 3 {
        return Err(BridgeError::LimitExceeded("depth"));
    }
    let initial_edges =
        u64::try_from(candidates.len()).map_err(|_| BridgeError::ArithmeticOverflow)?;
    let (nodes, edges) =
        candidates
            .iter()
            .try_fold((1_u64, initial_edges), |(nodes, edges), candidate| {
                let notes = u64::try_from(candidate.chart.notes.len())
                    .map_err(|_| BridgeError::ArithmeticOverflow)?;
                let rests = candidate
                    .chart
                    .notes
                    .windows(2)
                    .filter(|pair| pair[0].tick < pair[1].tick)
                    .count()
                    + usize::from(
                        candidate
                            .chart
                            .notes
                            .first()
                            .is_some_and(|note| note.tick > 0),
                    )
                    + usize::from(
                        candidate
                            .chart
                            .notes
                            .last()
                            .is_none_or(|note| note.tick < candidate.chart.span_ticks),
                    );
                let actions = notes
                    .checked_add(u64::try_from(rests).map_err(|_| BridgeError::ArithmeticOverflow)?)
                    .ok_or(BridgeError::ArithmeticOverflow)?;
                Ok::<_, BridgeError>((
                    nodes
                        .checked_add(actions + 1)
                        .ok_or(BridgeError::ArithmeticOverflow)?,
                    edges
                        .checked_add(actions)
                        .ok_or(BridgeError::ArithmeticOverflow)?,
                ))
            })?;
    if nodes > u64::from(limits.max_nodes) {
        return Err(BridgeError::LimitExceeded("nodes"));
    }
    if edges > limits.max_edges {
        return Err(BridgeError::LimitExceeded("edges"));
    }
    let prefix_bytes = ADAPTER_VERSION
        .len()
        .checked_add(1 + 64 + 1 + 64)
        .ok_or(BridgeError::ArithmeticOverflow)?;
    let suffix_bytes = candidates.iter().try_fold(10_usize, |largest, candidate| {
        let digits = decimal_digits(candidate.chart.notes.len());
        Ok::<_, BridgeError>(
            largest.max(
                digits
                    .checked_add(6)
                    .ok_or(BridgeError::ArithmeticOverflow)?,
            ),
        )
    })?;
    let required_string_bytes = prefix_bytes
        .checked_add(suffix_bytes)
        .ok_or(BridgeError::ArithmeticOverflow)?;
    if required_string_bytes
        > usize::try_from(limits.max_string_bytes).map_err(|_| BridgeError::ArithmeticOverflow)?
    {
        return Err(BridgeError::LimitExceeded("string bytes"));
    }
    Ok(())
}

const fn decimal_digits(mut value: usize) -> usize {
    let mut digits = 1;
    while value >= 10 {
        value /= 10;
        digits += 1;
    }
    digits
}

fn push_node(
    nodes: &mut Vec<Node>,
    provenance: &mut Vec<String>,
    node: Node,
    source: String,
) -> Result<u32, BridgeError> {
    let id = u32::try_from(nodes.len()).map_err(|_| BridgeError::ArithmeticOverflow)?;
    nodes.push(node);
    provenance.push(source);
    Ok(id)
}
