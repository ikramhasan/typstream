#!/usr/bin/env bash
# Builds Typst's parser into wasm/ (wasm-bindgen --target web glue, `wasm-opt -Oz` wasm), then the TypeScript API
# into dist/ (tsup bundles the glue), and copies the wasm next to it: the glue loads
# `new URL("syntax_bg.wasm", import.meta.url)`, from wasm/ in the sources and from dist/ once bundled.
#
# The wasm build is skipped when wasm/ was built from the same inputs (wasm/.inputs), so CI can restore it from a
# cache; FORCE=1 rebuilds anyway. WASM_ONLY=1 stops after the wasm (CI builds it before installing packages).
# Needs Rust >= 1.92 with wasm32-unknown-unknown, wasm-bindgen-cli at the version in Cargo.lock, and binaryen's
# wasm-opt.
set -euo pipefail
cd "$(dirname "$0")"

inputs=$( { sha256sum build.sh Cargo.toml Cargo.lock $(find rust -type f | sort); } | sha256sum | cut -d' ' -f1)
if [ -n "${FORCE:-}" ] || [ ! -f wasm/syntax_bg.wasm ] || [ "$(cat wasm/.inputs 2>/dev/null)" != "$inputs" ]; then
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

  rm -rf wasm
  cargo build --release --locked --target wasm32-unknown-unknown
  wasm-bindgen --target web --out-dir wasm --out-name syntax target/wasm32-unknown-unknown/release/typstream_syntax.wasm
  wasm-opt --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    --enable-reference-types --enable-multivalue -Oz wasm/syntax_bg.wasm -o wasm/syntax_bg.opt.wasm
  mv wasm/syntax_bg.opt.wasm wasm/syntax_bg.wasm
  rm -f wasm/syntax_bg.wasm.d.ts
  echo "$inputs" > wasm/.inputs
fi

[ -n "${WASM_ONLY:-}" ] && exit 0
tsup
cp wasm/syntax_bg.wasm dist/syntax_bg.wasm
