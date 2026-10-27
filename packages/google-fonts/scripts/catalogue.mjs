// Writes catalogue.json, the font catalogue index of the Google Fonts library
// (PLAN §6.4): every family in github.com/google/fonts at one commit, its font
// files, and where jsDelivr serves them.
//
//   node scripts/catalogue.mjs            # the commit in catalogue.json
//   node scripts/catalogue.mjs <commit>   # another one (a sha, or `main`)
//
// One request lists the repository's tree (paths and sizes); each family's
// METADATA.pb then gives its name and its files' styles and weights. Files
// jsDelivr won't serve (over 20 MB: CJK families, color emoji) are left out,
// and with them families left without a file.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "catalogue.json");
const REPO = "google/fonts";
/** jsDelivr answers 403 for GitHub files over 20 MB. */
const MAX_FILE_BYTES = 20 * 1000 * 1000;

const previous = () => {
  try {
    return JSON.parse(readFileSync(OUT, "utf8")).commit;
  } catch {
    return undefined;
  }
};

const get = async (url, as = "text") => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": "typstream-catalogue" } });
    if (response.ok) return as === "json" ? response.json() : response.text();
    if (attempt === 4 || response.status === 404) throw new Error(`${url}: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
};

/** The fields of METADATA.pb this needs: the family's name, its fonts and its axes. */
const parseMetadata = (text) => {
  const name = /^name: "((?:[^"\\]|\\.)*)"/m.exec(text)?.[1];
  const fonts = [...text.matchAll(/^fonts \{\n([\s\S]*?)^\}/gm)].map(([, body]) => ({
    style: /^\s*style: "(\w+)"/m.exec(body)?.[1] ?? "normal",
    weight: Number(/^\s*weight: (\d+)/m.exec(body)?.[1] ?? 400),
    filename: /^\s*filename: "([^"]+)"/m.exec(body)?.[1],
  }));
  const axes = Object.fromEntries(
    [...text.matchAll(/^axes \{\n\s*tag: "(\w+)"\n\s*min_value: ([\d.]+)\n\s*max_value: ([\d.]+)/gm)].map(
      ([, tag, min, max]) => [tag, [Number(min), Number(max)]],
    ),
  );
  return { name, fonts, axes };
};

/** Runs `fn` over `items`, `limit` at a time. */
const pool = async (items, limit, fn) => {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
};

const ref = process.argv[2] ?? previous() ?? "main";
const { sha: commit } = await get(`https://api.github.com/repos/${REPO}/commits/${ref}`, "json");
const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`, "json");
if (tree.truncated) throw new Error("the tree listing is truncated");
const sizes = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.size]));
const dirs = tree.tree
  .filter((e) => /^(ofl|apache|ufl)\/[^/]+\/METADATA\.pb$/.test(e.path))
  .map((e) => e.path.slice(0, -"METADATA.pb".length));

let done = 0;
const families = await pool(dirs, 24, async (dir) => {
  const meta = parseMetadata(await get(`https://raw.githubusercontent.com/${REPO}/${commit}/${dir}METADATA.pb`));
  if (++done % 200 === 0) console.error(`${done}/${dirs.length}`);
  const wght = meta.axes.wght;
  const files = meta.fonts
    .filter((f) => f.filename && (sizes.get(dir + f.filename) ?? Infinity) <= MAX_FILE_BYTES)
    .map((f) => ({
      path: dir + f.filename,
      style: f.style === "italic" ? "italic" : "normal",
      // A variable font covers its weight axis; METADATA gives its default instance's weight.
      weight: wght && /\[[^\]]*wght/.test(f.filename) ? wght : f.weight,
      bytes: sizes.get(dir + f.filename),
    }));
  return { name: meta.name, files };
});

const index = {};
const skipped = [];
for (const family of families) {
  if (!family.name || family.files.length === 0) {
    skipped.push(family.name);
    continue;
  }
  const key = family.name.toLowerCase();
  // Typst compares families lowercased; the first directory with a name wins.
  if (key in index) continue;
  index[key] = { name: family.name, files: family.files };
}
const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => (a < b ? -1 : 1)));
const catalogue = {
  version: 1,
  commit,
  base: `https://cdn.jsdelivr.net/gh/${REPO}@${commit}/`,
  families: sorted,
};
writeFileSync(OUT, `${JSON.stringify(catalogue)}\n`);
console.error(
  `${Object.keys(sorted).length} families at ${commit}; skipped ${skipped.length} without a servable file: ${skipped.join(", ")}`,
);
