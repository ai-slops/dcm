#![allow(unsafe_code, reason = "wit-bindgen generates canonical ABI shims")]

mod bindings {
    wit_bindgen::generate!({ path: "../../wit/chart", world: "runtime-world" });
    use super::Runtime;
    export!(Runtime);
}

use bindings::exports::pump::chart::runtime::Guest;

struct Runtime;

impl Guest for Runtime {
    fn generate(program_bytes: Vec<u8>, request_bytes: Vec<u8>) -> Result<Vec<u8>, String> {
        let limits = pump_chart::Limits::default();
        let program = pump_chart::decode_runtime_program(&program_bytes, &limits)
            .map_err(|error| error.to_string())?;
        let request = pump_chart::decode_generation_request(&request_bytes, &limits)
            .map_err(|error| error.to_string())?;
        let generated =
            pump_chart::generate(&program, &request).map_err(|error| error.to_string())?;
        pump_chart::encode_generated_chart(&generated).map_err(|error| error.to_string())
    }
}
