use anyhow::{Context, Result};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};

pub const FUEL: u64 = 10_000_000;
pub const MEMORY_BYTES: usize = 64 * 1024 * 1024;
pub const TABLE_ELEMENTS: usize = 10_000;
pub const INSTANCES: usize = 32;
pub const TABLES: usize = 32;
pub const MEMORIES: usize = 1;
pub const HOSTCALLS: u32 = 50_000;

pub fn engine() -> Result<Engine> {
    let mut config = Config::new();
    config
        .wasm_component_model(true)
        .consume_fuel(true)
        .wasm_simd(false)
        .wasm_relaxed_simd(false);
    Engine::new(&config).context("create deterministic Wasmtime engine")
}

pub fn limits() -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(MEMORY_BYTES)
        .table_elements(TABLE_ELEMENTS)
        .instances(INSTANCES)
        .tables(TABLES)
        .memories(MEMORIES)
        .trap_on_grow_failure(true)
        .build()
}

pub fn fuel<T>(store: &mut Store<T>) -> Result<()> {
    store.set_fuel(FUEL).context("set component fuel")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_memories_cannot_multiply_memory_budget() {
        let engine = engine().expect("engine");
        let module =
            wasmtime::Module::new(&engine, "(module (memory 1) (memory 1))").expect("module");
        let mut store = Store::new(&engine, limits());
        store.limiter(|limits| limits);
        fuel(&mut store).expect("fuel");
        assert!(wasmtime::Instance::new(&mut store, &module, &[]).is_err());
    }

    #[test]
    fn fuel_stops_infinite_wasm_loop() {
        // Given
        let engine = engine().expect("engine");
        let module = wasmtime::Module::new(&engine, "(module (func (export \"run\") (loop br 0)))")
            .expect("module");
        let mut store = Store::new(&engine, ());
        store.set_fuel(1_000).expect("fuel");
        let instance = wasmtime::Instance::new(&mut store, &module, &[]).expect("instance");
        let run = instance
            .get_typed_func::<(), ()>(&mut store, "run")
            .expect("run");

        // When
        let error = run
            .call(&mut store, ())
            .expect_err("loop must exhaust fuel");

        // Then
        assert!(!error.to_string().is_empty());
        assert_eq!(store.get_fuel().expect("remaining fuel"), 0);
    }
}
