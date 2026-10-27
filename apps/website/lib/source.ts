import type { Node, Root } from "fumadocs-core/page-tree";
import { type InferPageType, llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { docs } from "@/.source/server";
import { appName, description, docsRoute, githubUrl, markdownPath, siteUrl, tagline } from "./shared";

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export type DocsPage = InferPageType<typeof source>;

/** A page as Markdown: what `/docs/….md`, `Accept: text/markdown` and llms-full.txt serve. */
async function renderPage(page: DocsPage): Promise<string> {
  const body = await page.data.getText("processed");
  const lines = [`# ${page.data.title}`, ""];
  if (page.data.description) lines.push(`> ${page.data.description}`, "");
  lines.push(`Source: ${siteUrl}${page.url}`, "", body.trim(), "");
  return lines.join("\n");
}

export const docsLlms = llms(source, { renderPage });

function indexNode(node: Node, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  if (node.type === "separator") {
    out.push("", `## ${String(node.name ?? "")}`, "");
  } else if (node.type === "page") {
    const page = source.getNodePage(node);
    const summary = page?.data.description ? `: ${page.data.description}` : "";
    out.push(`${indent}- [${page?.data.title ?? String(node.name)}](${siteUrl}${markdownPath(node.url)})${summary}`);
  } else {
    if (depth === 0) out.push("", `## ${String(node.name ?? "")}`, "");
    else out.push(`${indent}- ${String(node.name ?? "")}`);
    const inner = depth === 0 ? 0 : depth + 1;
    if (node.index) indexNode(node.index, inner, out);
    for (const child of node.children) indexNode(child, inner, out);
  }
}

/**
 * llms.txt (llmstxt.org): what typstream is, how to read these docs as Markdown, and every page,
 * linked to its Markdown version.
 */
export function llmsIndex(): string {
  const tree: Root = source.getPageTree();
  const out = [
    `# ${appName}`,
    "",
    `> ${tagline} ${description}`,
    "",
    "Every page below is Markdown. Append `.md` to any docs URL (or send `Accept: text/markdown`) for the",
    `Markdown version; ${siteUrl}/llms-full.txt has all of them in one file. Source code: ${githubUrl}.`,
    "",
    "Key facts: Typst is pinned to 0.15.1. Offsets in every JS API are UTF-16 indices. Most React apps need only",
    'the `typstream` package (`import { Typstream } from "typstream"`); servers use `@typstream/node`.',
    "",
  ];
  for (const child of tree.children) indexNode(child, 0, out);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
