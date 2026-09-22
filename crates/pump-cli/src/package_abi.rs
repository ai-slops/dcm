use anyhow::{Context, Result, bail, ensure};
use wasmtime::Engine;
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component, ResourceType, Type};

use crate::package::Role;

pub fn validate(engine: &Engine, component: &Component, role: Role) -> Result<()> {
    let ty = component.component_type();
    let builder = match ty
        .imports(engine)
        .find(|(name, _)| *name == "pump:packages/operations@0.2.0")
    {
        Some((_, ComponentItem::ComponentInstance(operations))) => {
            match operations.get_export(engine, "builder") {
                Some(ComponentItem::Resource(resource)) => Some(resource),
                _ => bail!("operations builder resource is missing"),
            }
        }
        _ => None,
    };
    let (_, ComponentItem::ComponentInstance(interface)) = ty
        .exports(engine)
        .next()
        .context("package interface missing")?
    else {
        bail!("package export must be an interface");
    };
    let signatures: &[(&str, &str, &str)] = match role {
        Role::Song => &[("build", "", "result(unit,string)")],
        Role::Pattern => &[
            (
                "describe",
                "",
                "record(\"contract\":string,\"capabilities\":list(string))",
            ),
            (
                "render",
                "borrow(builder),record(\"base-panel\":u8,\"length\":u8,\"allow-mirror\":bool)",
                "result(u32,string)",
            ),
        ],
        Role::Style => &[
            (
                "describe",
                "",
                "record(\"contract\":string,\"policy-id\":string)",
            ),
            (
                "policy",
                "",
                "record(\"primary-weight\":u32,\"variation-weight\":u32,\"allow-mirror\":bool)",
            ),
        ],
    };
    for (name, params, results) in signatures {
        let Some(ComponentItem::ComponentFunc(function)) = interface.get_export(engine, name)
        else {
            bail!("missing package function {name}");
        };
        ensure!(
            !function.async_(),
            "asynchronous package functions are unsupported"
        );
        let actual_params = function
            .params()
            .map(|(_, ty)| shape(&ty, builder.as_ref(), 0))
            .collect::<Result<Vec<_>>>()?
            .join(",");
        let actual_results = function
            .results()
            .map(|ty| shape(&ty, builder.as_ref(), 0))
            .collect::<Result<Vec<_>>>()?
            .join(",");
        ensure!(
            actual_params == *params && actual_results == *results,
            "package function {name} has incompatible types"
        );
    }
    Ok(())
}

fn shape(ty: &Type, builder: Option<&ResourceType>, depth: u8) -> Result<String> {
    ensure!(depth < 8, "package ABI type nesting exceeds limit");
    Ok(match ty {
        Type::Bool => "bool".to_owned(),
        Type::U8 => "u8".to_owned(),
        Type::U32 => "u32".to_owned(),
        Type::String => "string".to_owned(),
        Type::Borrow(resource) => {
            ensure!(
                Some(resource) == builder,
                "package borrows a foreign resource type"
            );
            "borrow(builder)".to_owned()
        }
        Type::List(list) => format!("list({})", shape(&list.ty(), builder, depth + 1)?),
        Type::Record(record) => {
            ensure!(
                record.fields().len() <= 4,
                "package ABI record exceeds field limit"
            );
            let mut fields = Vec::new();
            for field in record.fields() {
                ensure!(
                    field.name.len() <= 128,
                    "package ABI field name exceeds limit"
                );
                fields.push(format!(
                    "{}:{}",
                    serde_json::to_string(field.name)?,
                    shape(&field.ty, builder, depth + 1)?
                ));
            }
            format!("record({})", fields.join(","))
        }
        Type::Result(result) => {
            let ok = result
                .ok()
                .map(|ty| shape(&ty, builder, depth + 1))
                .transpose()?
                .unwrap_or_else(|| "unit".to_owned());
            let err = result
                .err()
                .map(|ty| shape(&ty, builder, depth + 1))
                .transpose()?
                .unwrap_or_else(|| "unit".to_owned());
            format!("result({ok},{err})")
        }
        Type::S8
        | Type::S16
        | Type::U16
        | Type::S32
        | Type::S64
        | Type::U64
        | Type::Float32
        | Type::Float64
        | Type::Char
        | Type::Tuple(_)
        | Type::Variant(_)
        | Type::Enum(_)
        | Type::Option(_)
        | Type::Flags(_)
        | Type::Own(_)
        | Type::Future(_)
        | Type::Stream(_)
        | Type::ErrorContext => bail!("unsupported package ABI type"),
    })
}
