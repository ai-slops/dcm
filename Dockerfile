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
 && cargo build --locked --release --target wasm32-unknown-unknown -p pump-author-component -p pump-runtime-component -p pump-pattern-component -p pump-style-calm-component -p pump-style-bold-component -p pump-song-a-component -p pump-song-b-component -p pump-chart-author-component -p pump-chart-runtime-component -p pump-song-correlated-component \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_author_component.wasm -o /tmp/author.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_runtime_component.wasm -o /tmp/runtime.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_pattern_component.wasm -o /tmp/pattern.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_style_calm_component.wasm -o /tmp/style-calm.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_style_bold_component.wasm -o /tmp/style-bold.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_song_a_component.wasm -o /tmp/song-a.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_song_b_component.wasm -o /tmp/song-b.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_chart_author_component.wasm -o /tmp/chart-author.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_chart_runtime_component.wasm -o /tmp/chart-runtime.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_song_correlated_component.wasm -o /tmp/song-correlated.component.wasm
RUN cargo build --locked --release --target wasm32-unknown-unknown -p pump-pattern-component -p pump-song-a-component --features pump-pattern-component/test-failure,pump-song-a-component/test-recovery \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_pattern_component.wasm -o /tmp/fixture-pattern-failure.component.wasm \
 && wasm-tools component new target/wasm32-unknown-unknown/release/pump_song_a_component.wasm -o /tmp/fixture-song-recovery.component.wasm

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
WORKDIR /opt/pump
COPY --from=builder /src/target/release/pump ./pump
COPY --from=builder /tmp/author.component.wasm ./author.component.wasm
COPY --from=builder /tmp/runtime.component.wasm ./runtime.component.wasm
COPY --from=builder /tmp/pattern.component.wasm ./pattern.component.wasm
COPY --from=builder /tmp/style-calm.component.wasm ./style-calm.component.wasm
COPY --from=builder /tmp/style-bold.component.wasm ./style-bold.component.wasm
COPY --from=builder /tmp/song-a.component.wasm ./song-a.component.wasm
COPY --from=builder /tmp/song-b.component.wasm ./song-b.component.wasm
COPY --from=builder /tmp/fixture-pattern-failure.component.wasm ./fixture-pattern-failure.component.wasm
COPY --from=builder /tmp/fixture-song-recovery.component.wasm ./fixture-song-recovery.component.wasm
COPY --from=builder /tmp/chart-author.component.wasm ./chart-author.component.wasm
COPY --from=builder /tmp/chart-runtime.component.wasm ./chart-runtime.component.wasm
COPY --from=builder /tmp/song-correlated.component.wasm ./song-correlated.component.wasm
COPY examples/packages/*.json ./
COPY examples/feedback ./feedback
COPY examples/package-feedback ./package-feedback
ENTRYPOINT ["/opt/pump/pump"]
