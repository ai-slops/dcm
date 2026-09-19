FROM rust:1.94-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55 AS builder
WORKDIR /src
ENV CARGO_BUILD_JOBS=2
RUN rustup target add wasm32-unknown-unknown \
 && rustup component add rustfmt clippy
RUN cargo install --locked wasm-tools --version 1.254.0
COPY . .
RUN cargo fmt --all -- --check \
 && cargo clippy --locked --workspace --all-targets --all-features -- -D warnings \
 && cargo test --locked --workspace
RUN cargo build --locked --release -p pump \
 && cargo build --locked --release --target wasm32-unknown-unknown -p pump-author-component -p pump-runtime-component \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_author_component.wasm -o /tmp/author.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_runtime_component.wasm -o /tmp/runtime.component.wasm

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
WORKDIR /opt/pump
COPY --from=builder /src/target/release/pump ./pump
COPY --from=builder /tmp/author.component.wasm ./author.component.wasm
COPY --from=builder /tmp/runtime.component.wasm ./runtime.component.wasm
ENTRYPOINT ["/opt/pump/pump"]
