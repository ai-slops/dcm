use pump_core::{Builder, Limits, compile, decode_runtime_plan, encode_runtime_plan};

#[test]
fn strings_accepted_by_builder_roundtrip_through_codec() {
    let mut builder = Builder::new(Limits::default());
    let source = "s".repeat(256);
    let root = builder.tap(1, 1, "tap", &source).expect("bounded source");
    let runtime = compile(&builder.finish(root).expect("plan")).expect("compile");
    let bytes = encode_runtime_plan(&runtime).expect("encode");
    assert_eq!(decode_runtime_plan(&bytes).expect("decode"), runtime);
}

#[test]
fn individual_string_budget_prevents_unbounded_trace_amplification() {
    let mut builder = Builder::new(Limits::default());
    let source = "s".repeat(257);
    assert!(builder.tap(1, 1, "tap", &source).is_err());
    assert_eq!(builder.node_count(), 0);
}
