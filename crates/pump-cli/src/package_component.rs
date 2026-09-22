use anyhow::{Result, ensure};
use wasmtime::Engine;
use wasmtime::component::{Component, HasSelf, Linker};

use crate::package::Role;

pub fn validate(engine: &Engine, component: &Component, role: Role) -> Result<()> {
    let mut imports: Vec<String> = component
        .component_type()
        .imports(engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    imports.sort();
    match role {
        Role::Song => ensure!(
            imports
                == [
                    "pump:packages/lifecycle@0.2.0",
                    "pump:packages/operations@0.2.0",
                    "pump:packages/registry@0.2.0"
                ],
            "song imports do not match its role"
        ),
        Role::Pattern => ensure!(
            imports == ["pump:packages/operations@0.2.0"],
            "pattern imports do not match its role"
        ),
        Role::Style => ensure!(imports.is_empty(), "style components must import nothing"),
    }
    let expected = match role {
        Role::Song => "pump:packages/song@0.2.0",
        Role::Pattern => "pump:packages/pattern@0.2.0",
        Role::Style => "pump:packages/style@0.2.0",
    };
    let exports: Vec<_> = component
        .component_type()
        .exports(engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    ensure!(
        exports == [expected],
        "package exports do not match its role"
    );
    let mut linker = Linker::<crate::package_session::PackageState>::new(engine);
    match role {
        Role::Song => {
            crate::package_bindings::SongWorld::add_to_linker::<_, HasSelf<_>>(
                &mut linker,
                |state| state,
            )?;
            crate::package_bindings::SongWorldPre::new(linker.instantiate_pre(component)?)?;
        }
        Role::Pattern => {
            crate::pattern_bindings::PatternWorld::add_to_linker::<_, HasSelf<_>>(
                &mut linker,
                |state| state,
            )?;
            crate::pattern_bindings::PatternWorldPre::new(linker.instantiate_pre(component)?)?;
        }
        Role::Style => {
            crate::style_bindings::StyleWorldPre::new(linker.instantiate_pre(component)?)?;
        }
    }
    crate::package_abi::validate(engine, component, role)
}
