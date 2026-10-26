// Vendors Typst Universe packages into vendor/, as packages.typst.org serves them.
//
//   node scripts/vendor.mjs cetz:0.5.3 …   downloads each and prints its integrity (of the uncompressed
//                                          tar), for src/index.ts
//   node scripts/vendor.mjs --check        compares every vendor/*.tar.gz with upstream, byte for byte
//
// Add a package's dependencies too (the test lists any that are missing).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const vendor = fileURLToPath(new URL("../vendor/", import.meta.url));
const upstream = (file) => `https://packages.typst.org/preview/${file}`;
const sha256 = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

const download = async (file) => {
  const response = await fetch(upstream(file));
  if (!response.ok) throw new Error(`${upstream(file)}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const args = process.argv.slice(2);
if (args[0] === "--check") {
  let failed = false;
  for (const file of readdirSync(vendor).filter((f) => f.endsWith(".tar.gz"))) {
    const ours = sha256(readFileSync(`${vendor}${file}`));
    const theirs = sha256(await download(file));
    console.log(`${ours === theirs ? "ok  " : "DIFF"} ${file} ${ours}`);
    failed ||= ours !== theirs;
  }
  process.exit(failed ? 1 : 0);
}
if (args.length === 0) {
  console.error("usage: node scripts/vendor.mjs name:version … | --check");
  process.exit(1);
}
for (const spec of args) {
  const [name, version] = spec.split(":");
  const file = `${name}-${version}.tar.gz`;
  const bytes = await download(file);
  writeFileSync(`${vendor}${file}`, bytes);
  console.log(`${file} ${sha256(gunzipSync(bytes))}`);
}
