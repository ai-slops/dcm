use std::collections::BTreeMap;

use pump_chart::{Fraction, Limits, Note, WeightedChart};
use pump_core::{NodeId, RuntimePlan};

use crate::BridgeError;

mod choice;
mod emit;
mod execute;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(super) struct ChoiceKey {
    pub(super) decision_id: String,
    pub(super) occurrence: Vec<String>,
}

#[derive(Clone)]
pub(super) struct Binding {
    pub(super) node: NodeId,
    pub(super) branch: usize,
}

#[derive(Clone)]
pub(super) enum Action {
    Emit {
        node: NodeId,
        start: u64,
        mirrored: bool,
        occurrence: Vec<String>,
        depth: u32,
    },
    RepeatStep {
        child: NodeId,
        next: u32,
        count: u32,
        start: u64,
        duration: u64,
        mirrored: bool,
        occurrence: Vec<String>,
        decision_id: String,
        depth: u32,
    },
}

#[derive(Clone)]
pub(super) struct State {
    pub(super) pending: Vec<Action>,
    pub(super) notes: Vec<Note>,
    pub(super) environment: BTreeMap<ChoiceKey, Binding>,
    pub(super) mass: Fraction,
}

pub(super) struct Visit {
    pub(super) node: NodeId,
    pub(super) start: u64,
    pub(super) mirrored: bool,
    pub(super) occurrence: Vec<String>,
    pub(super) depth: u32,
}

pub(crate) struct Expansion {
    pub(crate) charts: Vec<WeightedChart>,
    pub(crate) total_mass: Fraction,
    pub(crate) work: u64,
}

pub(super) struct Interpreter<'a> {
    pub(super) source: &'a RuntimePlan,
    pub(super) music: &'a pump_chart::Music,
    pub(super) limits: &'a Limits,
    pub(super) active: Vec<State>,
    pub(super) finished: Vec<WeightedChart>,
    pub(super) work: u64,
    pub(super) events: u64,
}

pub(super) fn string_bytes(values: &[String]) -> Result<usize, BridgeError> {
    values.iter().try_fold(0_usize, |sum, value| {
        sum.checked_add(value.len())
            .ok_or(BridgeError::ArithmeticOverflow)
    })
}

pub(crate) fn expand(
    source: &RuntimePlan,
    music: &pump_chart::Music,
    limits: &Limits,
) -> Result<Expansion, BridgeError> {
    let initial = State {
        pending: vec![Action::Emit {
            node: source.root,
            start: 0,
            mirrored: false,
            occurrence: Vec::new(),
            depth: 1,
        }],
        notes: Vec::new(),
        environment: BTreeMap::new(),
        mass: Fraction::ONE,
    };
    let mut interpreter = Interpreter {
        source,
        music,
        limits,
        active: vec![initial],
        finished: Vec::new(),
        work: 0,
        events: 0,
    };
    interpreter.run()
}
