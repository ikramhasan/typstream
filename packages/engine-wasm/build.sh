#!/usr/bin/env bash
# Builds the engine into dist/:
#   engine.js        wasm-bindgen --target web glue (ES module; default export = async init, plus initSync)
#   engine.d.ts      types, including the result and Diagnostic types
#   engine_bg.wasm   release build after wasm-opt -Oz
#
#   ./build.sh                  # html + svg (the default build)
#   FEATURES=pdf ./build.sh     # also PDF export (not shipped; see #18)
#
# Needs Rust >= 1.92 with wasm32-unknown-unknown, wasm-bindgen-cli at the
# version in Cargo.lock, and binaryen's wasm-opt.
set -euo pipefail
cd "$(dirname "$0")"

# `pnpm build test` would pass "test" here and silently skip the tests.
if [ $# -gt 0 ]; then
  echo "build.sh takes no arguments (got: $*). Build and test: pnpm turbo run test --filter=@typstream/engine-wasm" >&2
  exit 1
fi

TARGET=wasm32-unknown-unknown
WASM=target/$TARGET/release/typstream_engine_wasm.wasm
# The wasm features rustc emits by default (Phase 0, rustc 1.99); wasm-opt must accept them.
WASM_OPT_FEATURES=(--enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext
                   --enable-mutable-globals --enable-reference-types --enable-multivalue)

need() { command -v "$1" >/dev/null || { echo "build.sh: $1 not found ($2)" >&2; exit 1; }; }
need cargo "install Rust >= 1.92"
need wasm-bindgen "cargo install wasm-bindgen-cli --version <Cargo.lock's wasm-bindgen> --locked"
need wasm-opt "install binaryen"

locked=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"/\1/p')
cli=$(wasm-bindgen --version | cut -d' ' -f2)
if [ "$locked" != "$cli" ]; then
  echo "build.sh: wasm-bindgen CLI is $cli but Cargo.lock has $locked; they must match" >&2
  exit 1
fi

cargo build --release --locked --target "$TARGET" ${FEATURES:+--features "$FEATURES"}

rm -rf dist
mkdir -p dist
wasm-bindgen --target web --out-dir dist --out-name engine "$WASM"
wasm-opt "${WASM_OPT_FEATURES[@]}" -Oz dist/engine_bg.wasm -o dist/engine_bg.opt.wasm
mv dist/engine_bg.opt.wasm dist/engine_bg.wasm
# wasm-bindgen's own .d.ts for the raw module; nobody imports it.
rm -f dist/engine_bg.wasm.d.ts

echo "built $(pwd)/dist ($(wc -c < dist/engine_bg.wasm | tr -d ' ') bytes of wasm)"
