#!/usr/bin/env bash
# Builds the oracle into pkg/ (wasm-bindgen --target nodejs). Requires the
# wasm32-unknown-unknown target and wasm-bindgen-cli matching Cargo.lock.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
rm -rf pkg
wasm-bindgen --target nodejs --out-dir pkg --out-name oracle \
  target/wasm32-unknown-unknown/release/typst_syntax_oracle.wasm
echo '{ "type": "commonjs" }' > pkg/package.json
echo "built $(pwd)/pkg"
