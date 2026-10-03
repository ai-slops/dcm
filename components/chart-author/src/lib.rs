#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/chart", world: "author-world", generate_all });
    use super::Author;
    export!(Author);
}

use bindings::exports::pump::chart::author::Guest;
use bindings::pump::chart::plan_builder::{Builder, WeightedNode};

struct Author;

impl Guest for Author {
    fn build() -> Result<(), String> {
        let builder = Builder::new();
        let hold = builder.hold(0b0000000010, 4, "hold.left", "example:left-hold")?;
        let rest = builder.rest(4, "breath", "example:negative-space")?;
        let phrase = builder.sequence(&[hold, rest], "phrase.base", "example:base-phrase")?;
        let mirrored = builder.mirror(phrase, "phrase.mirror", "example:mirrored-phrase")?;
        let staggered = builder.sequence(
            &[phrase, mirrored],
            "pattern.staggered",
            "example:staggered",
        )?;
        let held_pattern = builder.repeat(
            staggered,
            2,
            "pattern.held-repeat",
            "example:tempo-crossing-holds",
        )?;
        let bracket = builder.tap(
            0b0000000101,
            "bracket.center-corner",
            "example:allowed-bracket",
        )?;
        let parallel = builder.parallel(
            &[
                builder.rest(4, "parallel.delay", "example:parallel-delay")?,
                bracket,
            ],
            "pattern.parallel",
            "example:parallel-bracket",
        )?;
        let repeated = builder.repeat(parallel, 4, "pattern.repeated", "example:bounded-repeat")?;
        let choice = builder.choice(
            &[
                WeightedNode {
                    weight: 3,
                    node: held_pattern,
                },
                WeightedNode {
                    weight: 2,
                    node: repeated,
                },
            ],
            "chart.alternative",
            "example:distinct-candidate-patterns",
        )?;
        builder.finish(choice)
    }
}
