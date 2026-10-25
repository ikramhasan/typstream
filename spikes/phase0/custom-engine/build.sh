#!/usr/bin/env bash
# Builds the custom Typst 0.15.1 wasm engine in several feature variants.
#
#   ./build.sh                 # html, html-svg, full
#   ./build.sh html-svg        # just one variant
#   ./build.sh slim-html-svg   # patched-deps experiment (hypher english-only, no syntect syntaxes)
#   OPT_LEVELS="s 3" ./build.sh html-svg   # extra rust opt-level variants (dist/<variant>-opt<L>/)
#
# Output per variant in dist/<variant>/:
#   typstream_engine.js          wasm-bindgen --target web glue (ES module, default export = init)
#   typstream_engine.d.ts        types
#   typstream_engine_bg.wasm     wasm-opt -Oz  (the one to ship / load)
#   typstream_engine_bg.O3.wasm  wasm-opt -O3  (speed comparison)
#   typstream_engine_bg.raw.wasm straight out of wasm-bindgen
# and a size row appended to dist/sizes.tsv.
set -euo pipefail
cd "$(dirname "$0")"
export _ZO_DOCTOR=0

TARGET=wasm32-unknown-unknown
CRATE=typstream_engine
WASM_OPT_FEATURES=(--enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext
                   --enable-mutable-globals --enable-reference-types --enable-multivalue)

features_for() {
  case "$1" in
    html) echo "" ;;
    html-svg) echo "svg" ;;
    full) echo "svg,pdf" ;;
    slim-html) echo "" ;;
    slim-html-svg) echo "svg" ;;
    *) echo "unknown variant $1" >&2; exit 1 ;;
  esac
}

sz() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
gz() { gzip -9 -c "$1" | wc -c | tr -d ' '; }
br() { brotli -q 11 -c "$1" | wc -c | tr -d ' '; }

mkdir -p dist
[ -f dist/sizes.tsv ] || printf "variant\topt-level\traw\tOz\tO3\tOz.gz\tOz.br\tO3.gz\tO3.br\tjs\tjs.gz\n" > dist/sizes.tsv

build_variant() {
  local variant="$1" opt="${2:-z}" name="$1"
  [ "$opt" != "z" ] && name="$variant-opt$opt"
  local feats; feats="$(features_for "$variant")"
  # slim-*: same source, built from slim/Cargo.toml which [patch]es hypher + two-face (see RESULTS.md)
  local manifest=Cargo.toml artifact=typstream_engine tdir="target/opt-$opt"
  case "$variant" in slim-*) manifest=slim/Cargo.toml; artifact=typstream_engine_slim; tdir="target/slim-opt-$opt" ;; esac
  local out="dist/$name"
  echo "==> $name (features: ${feats:-<none>}, opt-level=$opt)"
  CARGO_PROFILE_RELEASE_OPT_LEVEL="$opt" \
    cargo build --manifest-path "$manifest" --release --target "$TARGET" --no-default-features \
      ${feats:+--features "$feats"} --target-dir "$tdir"
  rm -rf "$out"; mkdir -p "$out"
  wasm-bindgen --target web --out-dir "$out" --out-name "$CRATE" \
    "$tdir/$TARGET/release/$artifact.wasm"
  mv "$out/${CRATE}_bg.wasm" "$out/${CRATE}_bg.raw.wasm"
  wasm-opt "${WASM_OPT_FEATURES[@]}" -Oz "$out/${CRATE}_bg.raw.wasm" -o "$out/${CRATE}_bg.wasm"
  wasm-opt "${WASM_OPT_FEATURES[@]}" -O3 "$out/${CRATE}_bg.raw.wasm" -o "$out/${CRATE}_bg.O3.wasm"
  local raw oz o3 js
  raw="$out/${CRATE}_bg.raw.wasm"; oz="$out/${CRATE}_bg.wasm"; o3="$out/${CRATE}_bg.O3.wasm"; js="$out/$CRATE.js"
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$variant" "$opt" \
    "$(sz "$raw")" "$(sz "$oz")" "$(sz "$o3")" "$(gz "$oz")" "$(br "$oz")" "$(gz "$o3")" "$(br "$o3")" \
    "$(sz "$js")" "$(gz "$js")" | tee -a dist/sizes.tsv
}

VARIANTS=("$@")
[ ${#VARIANTS[@]} -eq 0 ] && VARIANTS=(html html-svg full)
for v in "${VARIANTS[@]}"; do
  build_variant "$v" z
  for l in ${OPT_LEVELS:-}; do build_variant "$v" "$l"; done
done
column -t dist/sizes.tsv
