#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/author", world: "author-world", generate_all });
    use super::Author;
    export!(Author);
}

use bindings::exports::pump::author::author::Guest;
use bindings::pump::author::plan_builder::{Builder, RelationKind, ScopeKind, WeightedNode};

struct Author;

impl Guest for Author {
    fn build() -> Result<(), String> {
        let builder = Builder::new(4096, 10_000);
        let mut taps = Vec::with_capacity(10);
        for panel in 0_u16..10 {
            taps.push(builder.tap(
                1_u16 << panel,
                1,
                &format!("tap.panel-{panel}"),
                "builtin-author:pump10",
            )?);
        }
        let sweep = builder.sequence(&taps, "sequence.sweep", "builtin-author:ten-panel-sweep")?;
        let left = taps
            .first()
            .copied()
            .ok_or_else(|| "missing left tap".to_owned())?;
        let right = taps
            .last()
            .copied()
            .ok_or_else(|| "missing right tap".to_owned())?;
        let edge_relation = builder.relation(
            RelationKind::Different,
            left,
            right,
            "relation.edges-different",
            "builtin-author:edge-relation",
        )?;
        let alternatives = vec![
            WeightedNode {
                weight: 3,
                node: left,
            },
            WeightedNode {
                weight: 2,
                node: right,
            },
        ];
        let choice = builder.choice(
            &alternatives,
            None,
            "choice.edge",
            "builtin-author:weighted-edge-choice",
        )?;
        let phrase = builder.sequence(
            &[sweep, edge_relation, choice],
            "sequence.phrase",
            "builtin-author:phrase",
        )?;
        let mirrored = builder.mirror(phrase, "mirror.phrase", "builtin-author:mirror")?;
        let section = builder.sequence(
            &[phrase, mirrored],
            "sequence.section",
            "builtin-author:section",
        )?;
        let repeated = builder.repeat(
            section,
            2,
            "repeat.section",
            "builtin-author:bounded-repeat",
        )?;
        let phrase_scope = builder.scope(
            ScopeKind::Phrase,
            "main-phrase",
            repeated,
            "scope.phrase",
            "builtin-author:phrase-scope",
        )?;
        let section_scope = builder.scope(
            ScopeKind::Section,
            "main-section",
            phrase_scope,
            "scope.section",
            "builtin-author:section-scope",
        )?;
        let run_scope = builder.scope(
            ScopeKind::Run,
            "default-run",
            section_scope,
            "scope.run",
            "builtin-author:run-scope",
        )?;
        builder.finish(run_scope)
    }
}
