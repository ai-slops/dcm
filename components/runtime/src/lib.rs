#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/runtime", world: "runtime-world" });
    use super::Runtime;
    export!(Runtime);
}

use bindings::exports::pump::runtime::runtime::Guest;

struct Runtime;

impl Guest for Runtime {
    fn generate(runtime_plan: Vec<u8>, seed: Vec<u8>) -> Result<Vec<u8>, String> {
        let plan =
            pump_core::decode_runtime_plan(&runtime_plan).map_err(|error| error.to_string())?;
        let trace = pump_core::generate(&plan, &seed).map_err(|error| error.to_string())?;
        pump_core::encode_trace(&trace).map_err(|error| error.to_string())
    }
}
