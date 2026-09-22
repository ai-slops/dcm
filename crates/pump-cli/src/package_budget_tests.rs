use std::sync::{Arc, Mutex};

use pump_core::Limits;
use wasmtime::{Instance, Module, Store};

use crate::package_session::{BuilderSession, lock};

#[test]
fn finishing_cannot_reopen_a_session_and_reset_quotas() {
    let mut session = BuilderSession::new(Limits::default());
    session
        .start_builder(Limits::default())
        .expect("initial builder");
    session.builder = None;
    session.child_fuel = 17;
    session.registry_attempts = 9;
    assert!(session.start_builder(Limits::default()).is_err());
    assert_eq!(session.child_fuel, 17);
    assert_eq!(session.registry_attempts, 9);
}

#[test]
fn creating_builder_preserves_precreation_registry_consumption() {
    let mut session = BuilderSession::new(Limits::default());
    session.charge_registry(None).expect("style preflight");
    session.child_fuel = 11;
    session.start_builder(Limits::default()).expect("create");
    assert_eq!(session.registry_attempts, 1);
    assert_eq!(session.child_fuel, 11);
    assert_eq!(session.hostcalls, 2);
}

#[test]
fn trapped_child_consumes_the_shared_fuel_pool() {
    let shared = Arc::new(Mutex::new(BuilderSession::new(Limits::default())));
    let engine = crate::engine::engine().expect("engine");
    let module =
        Module::new(&engine, "(module (func (export \"run\") (loop br 0)))").expect("module");
    let mut store = Store::new(&engine, ());
    store.set_fuel(100).expect("fuel");
    let instance = Instance::new(&mut store, &module, &[]).expect("instance");
    let run = instance
        .get_typed_func::<(), ()>(&mut store, "run")
        .expect("run");
    let result = crate::package_budget::run_child(&shared, &mut store, |store| run.call(store, ()));
    assert!(result.is_err());
    assert_eq!(lock(&shared).expect("session").child_fuel, 0);
}

#[test]
fn invalid_finish_roots_still_consume_hostcall_budget() {
    use crate::package_bindings::pump::packages::lifecycle::Host;
    use crate::package_session::{HostBuilder, PackageState};
    let shared = Arc::new(Mutex::new(BuilderSession::new(Limits::default())));
    let mut state = PackageState::new(shared.clone(), None);
    let resource = state
        .table
        .push(HostBuilder::parent(
            shared.clone(),
            "test".into(),
            "test".into(),
        ))
        .expect("view");
    let result = state
        .finish(resource, u32::MAX)
        .expect("recoverable invalid root");
    assert!(result.is_err());
    assert_eq!(lock(&shared).expect("session").hostcalls, 1);
}

#[test]
fn role_name_alone_cannot_certify_a_leafs_function_signatures() {
    let engine = crate::engine::engine().expect("engine");
    let component = wasmtime::component::Component::new(
        &engine,
        r#"
        (component
          (core module $m (func (export "run")))
          (core instance $i (instantiate $m))
          (func $run (canon lift (core func $i "run")))
          (instance $s (export "describe" (func $run)) (export "policy" (func $run)))
          (export "pump:packages/style@0.2.0" (instance $s)))
    "#,
    )
    .expect("valid component with incompatible types");
    assert!(
        crate::package_component::validate(&engine, &component, crate::package::Role::Style)
            .is_err()
    );
}
