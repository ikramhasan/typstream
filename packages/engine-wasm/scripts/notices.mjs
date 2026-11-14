// Writes the third-party notices of what build.sh compiles into engine_bg.wasm: every crate linked into it
// (normal dependencies for wasm32-unknown-unknown, proc macros and build scripts left out, since none of their
// code ships), with its license texts and NOTICE files, identical texts once. build.sh runs it after the cargo
// build, so the crates' sources are in Cargo's registry and the list is exactly what was built.
//
//   node scripts/notices.mjs <out>
//
// Most crates ship their license files. Those that don't (Typst's own crates, wasmi, krilla, …) get the SPDX text
// of the license they name: Apache-2.0 from licenses/Apache-2.0.txt, and for a choice of licenses the MIT one,
// with the crate's authors as its copyright line. Typst's crates also get Typst's NOTICE (licenses/typst-NOTICE,
// from the v0.15.1 tag), which its crates don't include.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/notices.mjs <out>");
  process.exit(1);
}

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown", "--locked"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ),
);
const packages = new Map(metadata.packages.map((p) => [p.id, p]));
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const isProcMacro = (p) => p.targets.some((t) => t.kind.includes("proc-macro"));

// Reachable through normal dependencies (`kind: null`) from the crate itself.
const linked = new Set();
const stack = [metadata.resolve.root];
while (stack.length > 0) {
  const id = stack.pop();
  if (linked.has(id)) continue;
  linked.add(id);
  for (const dep of nodes.get(id).deps) {
    if (dep.dep_kinds.some((k) => k.kind === null) && !isProcMacro(packages.get(dep.pkg))) stack.push(dep.pkg);
  }
}
linked.delete(metadata.resolve.root);

const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)/i;
const apache = readFileSync(join(root, "licenses/Apache-2.0.txt"), "utf8");
const typstNotice = readFileSync(join(root, "licenses/typst-NOTICE"), "utf8");

const mit = (holders) => `MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const zeroBsd = (holders) => `BSD Zero Clause License

Copyright (c) ${holders}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`;

// The texts for a crate that ships no license file, from the SPDX expression in its Cargo.toml.
function fromSpdx(p) {
  const holders = (p.authors.length > 0 ? p.authors : [`The ${p.name} authors`])
    .map((a) => a.replace(/\s*<[^>]*>/, ""))
    .join(", ");
  const ids = (p.license ?? "").split(/\s+OR\s+|\//).map((s) => s.trim().replace(/^\(|\)$/g, ""));
  if (ids.includes("MIT")) return [mit(holders)];
  if (ids.includes("0BSD")) return [zeroBsd(holders)];
  if (ids.length === 1 && ids[0] === "Apache-2.0") {
    return p.name === "typst" || p.name.startsWith("typst-") ? [apache, typstNotice] : [apache];
  }
  throw new Error(`${p.name}@${p.version}: no license file, and no text for "${p.license}"`);
}

// Identical texts once, with every crate they apply to.
const groups = new Map();
const sorted = [...linked].map((id) => packages.get(id)).sort((a, b) => a.name.localeCompare(b.name));
for (const p of sorted) {
  const dir = dirname(p.manifest_path);
  const files = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort();
  const texts = files.length > 0 ? files.map((f) => readFileSync(join(dir, f), "utf8")) : fromSpdx(p);
  for (const text of texts) {
    const key = text.replace(/\s+/g, " ").trim();
    if (!groups.has(key)) groups.set(key, { text: text.trimEnd(), crates: [] });
    groups.get(key).crates.push(`${p.name} ${p.version} (${p.license ?? "see below"})`);
  }
}

const rule = "=".repeat(80);
const parts = [
  `Third-party notices for @typstream/engine-wasm

engine_bg.wasm is Typst 0.15.1 (https://github.com/typst/typst, Apache-2.0) and the Rust crates it links,
compiled to WebAssembly. Their licenses and notices follow, each text once, after the crates it applies to.

src/raster/ in the source of this package is typst-render 0.15.1 (Apache-2.0), changed as its mod.rs describes.

The fonts in fonts/ have their own notices: fonts/NOTICE (Typst's bundled fonts) and fonts/LICENSE-Noto.txt
(the Noto script fonts).

${sorted.length} crates.`,
];
for (const { text, crates } of groups.values()) {
  parts.push(`${rule}\nApplies to:\n${crates.map((c) => `* ${c}`).join("\n")}\n${rule}\n\n${text}`);
}
writeFileSync(out, `${parts.join("\n\n")}\n`);
console.log(`wrote ${out}: ${sorted.length} crates, ${groups.size} texts`);
