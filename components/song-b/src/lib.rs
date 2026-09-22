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
        let first = registry::instantiate_pattern(
            &builder,
            "pattern",
            "render",
            PatternArgs {
                base_panel: 2,
                length: 4,
                allow_mirror: style.allow_mirror,
            },
            "verse-b1",
        )?;
        let second = registry::instantiate_pattern(
            &builder,
            "pattern",
            "render",
            PatternArgs {
                base_panel: 6,
                length: 3,
                allow_mirror: false,
            },
            "verse-b2",
        )?;
        let choice = builder.choice(
            &[
                WeightedNode {
                    weight: style.primary_weight,
                    node: first,
                },
                WeightedNode {
                    weight: style.variation_weight,
                    node: second,
                },
            ],
            Some(4),
            "song-choice",
        )?;
        let root = builder.sequence(&[choice, second], "song-sequence")?;
        lifecycle::finish(&builder, root)
    }
}
