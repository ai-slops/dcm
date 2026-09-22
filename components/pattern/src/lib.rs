#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/package", world: "pattern-world", generate_all });
    use super::Pattern;
    export!(Pattern);
}

use bindings::exports::pump::packages::pattern::{Description, Guest, PatternArgs};
use bindings::pump::packages::operations::Builder;

struct Pattern;

impl Guest for Pattern {
    fn describe() -> Description {
        Description {
            contract: "pump.pattern/v1".to_owned(),
            capabilities: vec![
                "pump.mirror".to_owned(),
                "pump.sequence".to_owned(),
                "pump.tap".to_owned(),
            ],
        }
    }

    fn render(builder: &Builder, args: PatternArgs) -> Result<u32, String> {
        if args.length == 0 || args.length > 16 || args.base_panel >= 10 {
            return Err("pattern arguments are outside the public contract".to_owned());
        }
        if cfg!(feature = "test-failure") {
            builder.tap(1, 1, "failed-child-mutation")?;
            return Err("intentional fixture failure after mutation".to_owned());
        }
        let mut taps = Vec::with_capacity(usize::from(args.length));
        for offset in 0..args.length {
            let panel = (args.base_panel + offset) % 10;
            taps.push(builder.tap(1_u16 << panel, 1, &format!("tap-{offset}"))?);
        }
        let sequence = builder.sequence(&taps, "sequence")?;
        if args.allow_mirror {
            builder.mirror(sequence, "mirror")
        } else {
            Ok(sequence)
        }
    }
}
