# Phase 4 spike: native vs. wasm on the server (#22)

Throwaway. It measured whether `@typstream/node` should run Typst as engine-wasm or as a native addon. Findings and the decision are in the [#22 comment](https://github.com/ikramhasan/typstream/issues/22#issuecomment-6405646790) and PLAN.md's decision log. In short: wasm, because native compiles can't be interrupted and a memory bomb aborts the process.

- `native/`: engine-wasm's `MemWorld` (`world.rs`, with `today()` on `std`) behind napi-rs 3. `cargo build --release`, then copy `target/release/libtypstream_node_native_spike.so` to `native/typstream_native.node`.
- `bench.mjs`: cold start (fresh processes) and warm compiles over `corpus/edu`, for both engines. `WASM_DIR` must hold an engine-wasm build with the `pdf` feature (`packages/engine-wasm/dist/pdf` now).
- `kill.mjs`: runs a corpus `limit` document in a worker thread, calls `worker.terminate()` after 1 s, and reports whether and how fast the thread stops.

```bash
WASM_DIR=../../packages/engine-wasm/dist/pdf node bench.mjs
WASM_DIR=../../packages/engine-wasm/dist/pdf node kill.mjs wasm runaway-cpu-loop
node kill.mjs native runaway-cpu-loop   # hangs: terminate() never returns
```
