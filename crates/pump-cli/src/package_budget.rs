use std::sync::{Arc, Mutex};

use anyhow::Result;
use wasmtime::Store;

use crate::package_session::{BuilderSession, lock};

pub fn run_child<T, R>(
    shared: &Arc<Mutex<BuilderSession>>,
    store: &mut Store<T>,
    call: impl FnOnce(&mut Store<T>) -> Result<R>,
) -> Result<R> {
    let result = call(store);
    lock(shared)?.child_fuel = store.get_fuel().unwrap_or(0);
    result
}
