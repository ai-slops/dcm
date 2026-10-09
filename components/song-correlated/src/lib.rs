#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/package", world: "song-world", generate_all });
    use super::Song;
    export!(Song);
}

use bindings::exports::pump::packages::song::Guest;
use bindings::pump::packages::lifecycle;
use bindings::pump::packages::operations::WeightedNode;
use bindings::pump::packages::registry::{self, PatternArgs};

struct Song;

impl Guest for Song {
    fn build() -> Result<(), String> {
        let builder = lifecycle::create(4096, 10_000);
        let style = registry::instantiate_style("style", "policy")?;
        let pattern = registry::instantiate_pattern(
            &builder,
            "pattern",
            "render",
            PatternArgs {
                base_panel: 0,
                length: 5,
                allow_mirror: style.allow_mirror,
            },
            "linked-phrase",
        )?;
        let accent = builder.tap(1 << 9, 1, "accent")?;
        let choice = builder.choice(
            &[
                WeightedNode {
                    weight: style.primary_weight,
                    node: pattern,
                },
                WeightedNode {
                    weight: style.variation_weight,
                    node: accent,
                },
            ],
            Some(5),
            "linked-choice",
        )?;
        let root = builder.sequence(&[choice, choice], "linked-repeat")?;
        lifecycle::finish(&builder, root)
    }
}
