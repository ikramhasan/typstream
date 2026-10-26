#!/usr/bin/env bash
# Builds the engine into dist/:
#   engine.js        wasm-bindgen --target web glue (ES module; default export = async init, plus initSync)
#   engine.d.ts      types, including the result and Diagnostic types
#   engine_bg.wasm   release build after wasm-opt -Oz: HTML, SVG and PDF (#18 put PDF in the one build)
#   fonts/           the base font set (PLAN §6.4), copied from typst-assets, with its license NOTICE,
#                    and the script fonts (Noto, downloaded at a pinned commit and checked), LICENSE-Noto.txt
#   fonts.js         `baseFonts` and `scriptFonts` (scripts/fonts.mjs): their URLs, as
#                    `new URL("./fonts/…", import.meta.url)` for bundlers, and the script fonts' FontInfo
#
# It skips the build when dist/ was built from the same inputs (dist/.inputs), so
# CI can restore dist/ from a cache and turbo's build is then a no-op. FORCE=1
# rebuilds anyway.
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

# Everything the output depends on. Cargo.lock pins the crates (and wasm-bindgen's version).
inputs=$( { sha256sum build.sh Cargo.toml Cargo.lock scripts/fonts.mjs $(find src -type f | sort); } | sha256sum | cut -d' ' -f1)
if [ -z "${FORCE:-}" ] && [ -f dist/engine_bg.wasm ] && [ "$(cat dist/.inputs 2>/dev/null)" = "$inputs" ]; then
  echo "dist/ is up to date (FORCE=1 to rebuild)"
  exit 0
fi

TARGET=wasm32-unknown-unknown
WASM=target/$TARGET/release/typstream_engine_wasm.wasm
# The wasm features rustc emits by default (Phase 0, rustc 1.99); wasm-opt must accept them.
WASM_OPT_FEATURES=(--enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext
                   --enable-mutable-globals --enable-reference-types --enable-multivalue)

need() { command -v "$1" >/dev/null || { echo "build.sh: $1 not found ($2)" >&2; exit 1; }; }
need cargo "install Rust >= 1.92"
need curl "to download the script fonts"
need wasm-bindgen "cargo install wasm-bindgen-cli --version <Cargo.lock's wasm-bindgen> --locked"
need wasm-opt "install binaryen"

locked=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"/\1/p')
cli=$(wasm-bindgen --version | cut -d' ' -f2)
if [ "$locked" != "$cli" ]; then
  echo "build.sh: wasm-bindgen CLI is $cli but Cargo.lock has $locked; they must match" >&2
  exit 1
fi

rm -rf dist
cargo build --release --locked --target "$TARGET"
mkdir -p dist
wasm-bindgen --target web --out-dir dist --out-name engine "$WASM"
wasm-opt "${WASM_OPT_FEATURES[@]}" -Oz dist/engine_bg.wasm -o dist/engine_bg.opt.wasm
mv dist/engine_bg.opt.wasm dist/engine_bg.wasm
# wasm-bindgen's own .d.ts for the raw module; nobody imports it.
rm -f dist/engine_bg.wasm.d.ts

# The base fonts: Typst's defaults for text, math and raw (PLAN §6.4: ≈ 2.6 MB raw, 1.45 MB brotli).
# Taken from the typst-assets crate the build just downloaded, so they are the files native typst embeds.
FONTS=(LibertinusSerif-Regular.otf LibertinusSerif-Bold.otf LibertinusSerif-Italic.otf NewCMMath-Regular.otf DejaVuSansMono.ttf)
assets=$(cargo metadata --format-version 1 --locked | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const p = JSON.parse(s).packages.find((p) => p.name === "typst-assets");
    console.log(require("node:path").dirname(p.manifest_path));
  });')
mkdir -p dist/fonts
for font in "${FONTS[@]}"; do cp "$assets/files/fonts/$font" dist/fonts/; done
cp "$assets/NOTICE" dist/fonts/NOTICE

# Script fonts (#11, PLAN §6.4): registered from their FontInfo and downloaded only when a document
# uses them. Noto (OFL), unhinted static TTFs, regular and bold, from notofonts.github.io at a pinned
# commit, checked by SHA-256 and cached in target/. Book styles, to match Libertinus Serif: Naskh
# for Arabic, Serif for Bengali and Devanagari. `script:file sha256` per line.
NOTO=https://raw.githubusercontent.com/notofonts/notofonts.github.io/31c61988e76a48706c4a96a872fc3178dbd82121/fonts
SCRIPT_FONTS=(
  "Arab:NotoNaskhArabic-Regular.ttf c34fdbd98af4dbc45ca192a23d2eeb77032add83086f5fe32957d23b3f36b221"
  "Arab:NotoNaskhArabic-Bold.ttf 380ac34b249d336e1a43c21053df440594e1e3db8f75fabd4d85b649ca1ea4c6"
  "Beng:NotoSerifBengali-Regular.ttf bb5cc3ffa1d1b1f1adfe2c4c96af5c768882b594263c428e03046bdaebf83c26"
  "Beng:NotoSerifBengali-Bold.ttf 18d666c8332d1e7c9440420e8fb9b7ae8f773c4319af758667b6031d2ac15b2d"
  "Deva:NotoSerifDevanagari-Regular.ttf 565948535503fba5ec4989d9fad14e8c3056b998b1133e2e05d664a73b517007"
  "Deva:NotoSerifDevanagari-Bold.ttf 0220d0e616fe2a1c77a7980a8c0ad5f44fdf5c6fed575436fda348b96dc3b916"
)
NOTO_LICENSE_SHA256=f2095b08bed08b23a6fe26112fcd679a2bee3f002eef077eb05d215ed1051bd8
fetch() { # url sha256 out
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null; then
    mkdir -p "$(dirname "$3")"
    curl -fsSL --retry 3 -o "$3.tmp" "$1"
    echo "$2  $3.tmp" | sha256sum -c --quiet - || { echo "build.sh: $1 doesn't match its SHA-256" >&2; exit 1; }
    mv "$3.tmp" "$3"
  fi
}
script_args=()
for entry in "${SCRIPT_FONTS[@]}"; do
  read -r spec sha <<< "$entry"
  file=${spec#*:}
  family=${file%%-*}
  fetch "$NOTO/$family/unhinted/ttf/$file" "$sha" "target/script-fonts/$file"
  cp "target/script-fonts/$file" dist/fonts/
  script_args+=("$spec")
done
fetch "$NOTO/LICENSE" "$NOTO_LICENSE_SHA256" target/script-fonts/LICENSE
cp target/script-fonts/LICENSE dist/fonts/LICENSE-Noto.txt
node scripts/fonts.mjs --base "${FONTS[@]}" --script "${script_args[@]}"
echo "$inputs" > dist/.inputs

echo "built $(pwd)/dist ($(wc -c < dist/engine_bg.wasm | tr -d ' ') bytes of wasm)"
