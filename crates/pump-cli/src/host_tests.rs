use crate::author_bindings::pump::author::plan_builder::HostBuilder;
use crate::author_host::HostState;

#[test]
fn multiple_builders_cannot_bypass_session_budgets() {
    let mut host = HostState::new(crate::engine::limits());
    let first = host.new(4096, 10_000).expect("first builder");
    host.drop(first).expect("drop builder");
    assert!(host.new(4096, 10_000).is_err());
}

#[test]
fn runtime_rejects_any_component_import() -> anyhow::Result<()> {
    let engine = crate::engine::engine()?;
    let component =
        wasmtime::component::Component::new(&engine, "(component (import \"evil\" (func)))")?;
    let error = crate::commands::ensure_runtime_import_free(&engine, &component)
        .expect_err("import must fail");
    assert!(error.to_string().contains("evil"));
    Ok(())
}
