// Checks the docs content without building the site (the `test` script):
//   - every page has a title and a description (its summary in llms.txt and search);
//   - every page is listed in its folder's meta.json, and every listed page exists;
//   - every internal link (`/docs/…`, with or without `#anchor`) points to a page, and to a heading on it.
// The build itself checks that the MDX compiles and the type tables generate.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import GithubSlugger from "github-slugger";

const content = fileURLToPath(new URL("../content/docs", import.meta.url));
const errors = [];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );

/** `/docs/a/b` for content/docs/a/b.mdx, `/docs/a` for content/docs/a/index.mdx. */
const urlOf = (file) =>
  `/docs/${relative(content, file)
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "")}`.replace(/\/$/, "");

/** Heading slugs as Fumadocs makes them: github-slugger over the heading's text. */
function anchors(text) {
  const slugger = new GithubSlugger();
  const out = new Set();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = line.match(/^#{2,6}\s+(.*?)\s*$/);
    if (m) out.add(slugger.slug(m[1].replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
  }
  return out;
}

const pages = new Map();
for (const file of walk(content)) {
  const text = readFileSync(file, "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  for (const key of ["title", "description"])
    if (!new RegExp(`^${key}: \\S`, "m").test(fm)) errors.push(`${relative(content, file)}: no ${key}`);
  pages.set(urlOf(file), { file, text, anchors: anchors(text) });
}

// meta.json lists every page in its folder, and only pages that exist.
const dirs = (dir) => [
  dir,
  ...readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => dirs(join(dir, e.name))),
];
for (const d of dirs(content)) {
  const name = relative(content, d) || ".";
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
  } catch {
    errors.push(`${name}: no meta.json`);
    continue;
  }
  const listed = new Set(meta.pages.filter((p) => !p.startsWith("---")).map((p) => p.replace(/^\.\.\./, "")));
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.name.endsWith(".mdx")) continue;
    const page = entry.name.replace(/\.mdx$/, "");
    if (!listed.has(page)) errors.push(`${name}/meta.json doesn't list ${page}`);
  }
  for (const page of listed)
    if (!readdirSync(d).some((f) => f === page || f === `${page}.mdx`))
      errors.push(`${name}/meta.json lists missing ${page}`);
}

for (const [url, page] of pages) {
  let fence = false;
  for (const line of page.text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    for (const m of line.matchAll(/(?:\]\(|href=["'])(\/docs[^)"'\s]*)/g)) {
      const [path, hash] = m[1].split("#");
      const target = pages.get(path.replace(/\/$/, ""));
      if (!target) errors.push(`${url}: link to missing page ${m[1]}`);
      else if (hash && !target.anchors.has(hash)) errors.push(`${url}: link to missing heading ${m[1]}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`check-docs: ${errors.length} problem(s) in ${pages.size} pages`);
  process.exit(1);
}
console.log(`check-docs: ${pages.size} pages, titles, descriptions, navigation and links OK`);
