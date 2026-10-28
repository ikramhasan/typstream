#!/usr/bin/env bash
# Builds the engine into dist/:
#   engine.js        wasm-bindgen --target web glue (ES module; default export = async init, plus initSync)
#   engine.d.ts      types, including the result and Diagnostic types
#   engine_bg.wasm   release build after wasm-opt -Oz: HTML, SVG and PDF (#18 put PDF in the one build)
#   fonts/           the base font set (PLAN §6.4) from typst-assets, its CFF fonts converted to TrueType
#                    outlines (#118), with its license NOTICE, and the script fonts (Noto, downloaded at a
#                    pinned commit and checked), LICENSE-Noto.txt
#   fonts.js         `baseFonts` and `scriptFonts` (scripts/fonts.mjs): their URLs, as
#                    `new URL("./fonts/…", import.meta.url)` for bundlers, and the script fonts' FontInfo
#
# It skips the build when dist/ was built from the same inputs (dist/.inputs), so
# CI can restore dist/ from a cache and turbo's build is then a no-op. FORCE=1
# rebuilds anyway.
#
# Needs Rust >= 1.92 with wasm32-unknown-unknown, wasm-bindgen-cli at the
# version in Cargo.lock, binaryen's wasm-opt, and Python 3 (the font conversion).
set -euo pipefail
cd "$(dirname "$0")"

# `pnpm build test` would pass "test" here and silently skip the tests.
if [ $# -gt 0 ]; then
  echo "build.sh takes no arguments (got: $*). Build and test: pnpm turbo run test --filter=@typstream/engine-wasm" >&2
  exit 1
fi

# Everything the output depends on. Cargo.lock pins the crates (and wasm-bindgen's version).
inputs=$( { sha256sum build.sh Cargo.toml Cargo.lock scripts/fonts.mjs scripts/otf2ttf.py $(find src -type f | sort); } | sha256sum | cut -d' ' -f1)
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
need python3 "to convert the CFF base fonts to TrueType outlines"
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

fetch() { # url sha256 out: downloads once into target/, checked by SHA-256
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null; then
    mkdir -p "$(dirname "$3")"
    curl -fsSL --retry 3 -o "$3.tmp" "$1"
    echo "$2  $3.tmp" | sha256sum -c --quiet - || { echo "build.sh: $1 doesn't match its SHA-256" >&2; exit 1; }
    mv "$3.tmp" "$3"
  fi
}

# Typst's bundled fonts, all 17 faces native typst embeds (PLAN §6.4), from the typst-assets crate the build
# just downloaded, so every engine chooses from the same faces and picks the same ones (#128): native typst,
# @typstream/node (which copies these files) and the browser, where the five every ordinary document uses are
# the base fonts (downloaded at startup) and the other twelve are lazy, registered by FontInfo and downloaded the
# first time a document uses them. Word embeds only TrueType outlines, and the canvas, the PDF and the DOCX must use
# the same files (#118), so the faces typst-assets ships with CFF outlines are converted (scripts/otf2ttf.py,
# fontTools' pure-Python wheel at a pinned version): the same fonts, laid out the same, under the same names. The
# conversion is reproducible, so its output is pinned too; a new fontTools or typst-assets means new hashes here.
# `file sha256` per line.
CONVERTED=(
  "LibertinusSerif-Regular 3fef5b907611c222c8d398d26841cf7ad1e172c30cd6b04d0310b4f58f53c746"
  "LibertinusSerif-Bold 29b465eefb4806bf1e0ef5f59ec0b02909a318a5d41bf95fd299f453482bee6c"
  "LibertinusSerif-Italic 8a04d4879543542b6a2f3d14323d4c49111d9884d38edfaeeddf6a619c81cc12"
  "LibertinusSerif-BoldItalic 4747eaf31f366ec31074955fe23156b54cbfb3844f31a393b2d33d79ac77fb27"
  "LibertinusSerif-Semibold 13aade5b6aedba56290f567d93e553e99856cfb58f87c9c0eabc8059f56ed8e7"
  "LibertinusSerif-SemiboldItalic 0e70a2c6ac232a62a5d36936d197a5fbb8b62edf1ff74c675c3d6ec11b408297"
  "NewCMMath-Book b5a2ebf704a159956d51516f5f98b9122c9e80046b89731e75a64511fe5c68a9"
  "NewCMMath-Regular be2bdfa66ab52d4dfcb0434c4358b6bc4315026d433d3091f729d90623c58935"
  "NewCMMath-Bold 5f4aa06a4b782563661276878dbd015e1c1c10a74bb7bc5d05894e047320054d"
  "NewCM10-Regular beaaa4d396bd78647ac0f0aed3a3076ca7d69d05ea9ff2c06e8d0547ef9b9bc7"
  "NewCM10-Bold 6dea3e3f1a0e5ad1f79458945ee659bf9cf4c63453a4d3e217aafc718f29cbc7"
  "NewCM10-Italic 587abd7432740704e02e38424de483e7f3acdab36d2985c5b3f90486123c8a21"
  "NewCM10-BoldItalic 60a846b6f6216e120aaccac67285bb318994b4acd5959ffd3c25d1a02fe9fec5"
)
COPIED=(DejaVuSansMono.ttf DejaVuSansMono-Bold.ttf DejaVuSansMono-Oblique.ttf DejaVuSansMono-BoldOblique.ttf)
# What ordinary documents use (#128): Typst sets math in NewCMMath-Book, whatever order fonts are registered in.
BASE=(LibertinusSerif-Regular.ttf LibertinusSerif-Bold.ttf LibertinusSerif-Italic.ttf NewCMMath-Book.ttf DejaVuSansMono.ttf)
FONTTOOLS=fonttools-4.68.0-py3-none-any.whl
FONTTOOLS_URL=https://files.pythonhosted.org/packages/35/74/4ea331ecc65ba05a58b1e4e8ccd604c8a15565f876dfbf93fc2a2ea2e22b/$FONTTOOLS
FONTTOOLS_SHA256=d76f8fdcb6936f5e1045a0c9dd721a4bf11112e60d1e243bfa1d39f06a8b3104
assets=$(cargo metadata --format-version 1 --locked | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const p = JSON.parse(s).packages.find((p) => p.name === "typst-assets");
    console.log(require("node:path").dirname(p.manifest_path));
  });')
mkdir -p dist/fonts
for font in "${COPIED[@]}"; do cp "$assets/files/fonts/$font" dist/fonts/; done
fetch "$FONTTOOLS_URL" "$FONTTOOLS_SHA256" "target/fonttools/$FONTTOOLS"
for entry in "${CONVERTED[@]}"; do
  read -r name sha <<< "$entry"
  python3 -I scripts/otf2ttf.py "target/fonttools/$FONTTOOLS" "$assets/files/fonts/$name.otf" "dist/fonts/$name.ttf"
  echo "$sha  dist/fonts/$name.ttf" | sha256sum -c --quiet - ||
    { echo "build.sh: converted $name.ttf doesn't match its pinned SHA-256 (new fontTools or typst-assets?)" >&2; exit 1; }
done
# Every bundled face that isn't a base font is lazy.
EXTRA=()
for font in $(cd dist/fonts && ls *.ttf | sort); do
  [[ " ${BASE[*]} " == *" $font "* ]] || EXTRA+=("$font")
done
if [ ${#BASE[@]} -ne 5 ] || [ ${#EXTRA[@]} -ne 12 ]; then
  echo "build.sh: expected 5 base and 12 lazy bundled faces, got ${#BASE[@]} and ${#EXTRA[@]}" >&2
  exit 1
fi
{
  cat "$assets/NOTICE"
  cat <<'NOTICE'

================================================================================
Changes made by typstream

The LibertinusSerif-*.ttf, NewCMMath-*.ttf and NewCM10-*.ttf files are modified
versions of the .otf files of the same names in typst-assets
(https://github.com/typst/typst-assets, crate typst-assets on crates.io, the version
this engine pins): their CFF outlines were converted to TrueType outlines with
fontTools' cu2qu (at most 1 font unit of error) and their hinting removed; every other
table is unchanged. Each says so in its name table (name ID 10). They remain under the
licenses above (SIL OFL 1.1 for Libertinus Serif; the GUST Font License for New
Computer Modern, but NewCM10-Regular, under the GPL 3 with the Font and Distribution
Exceptions). The unmodified originals are in typst-assets; the conversion is
packages/engine-wasm/scripts/otf2ttf.py in https://github.com/ikramhasan/typstream,
which with the originals is the corresponding source of the converted files.
NOTICE
} > dist/fonts/NOTICE

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
node scripts/fonts.mjs --base "${BASE[@]}" --extra "${EXTRA[@]}" --script "${script_args[@]}"
echo "$inputs" > dist/.inputs

echo "built $(pwd)/dist ($(wc -c < dist/engine_bg.wasm | tr -d ' ') bytes of wasm)"
