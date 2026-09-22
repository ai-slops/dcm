#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/package", world: "style-world", generate_all });
    use super::Style;
    export!(Style);
}

use bindings::exports::pump::packages::style::{Description, Guest, StylePolicy};

struct Style;

impl Guest for Style {
    fn describe() -> Description {
        Description {
            contract: "pump.style/v1".to_owned(),
            policy_id: "calm-v1".to_owned(),
        }
    }

    fn policy() -> StylePolicy {
        StylePolicy {
            primary_weight: 5,
            variation_weight: 1,
            allow_mirror: false,
        }
    }
}
