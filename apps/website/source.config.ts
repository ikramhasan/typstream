import { resolve } from "node:path";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { createFileSystemGeneratorCache, createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";
import type { Nodes, Root } from "mdast";

// Type tables are generated from the packages' TSDoc at build time (`<auto-type-table>`), so the
// reference can't drift from the code, and they come out as Markdown tables in llms.txt too.
// Paths are relative to the repository root (`path="packages/react/src/Typstream.tsx"`), and types are
// written out in full rather than simplified to `union` or `function`.
const generator = createGenerator({ cache: createFileSystemGeneratorCache(".next/fumadocs-typescript") });
const typeTableOptions = { basePath: resolve(process.cwd(), "../.."), typeSimplifier: { shouldSimplify: () => false } };

// Interactive demos need a browser and the engine. Agents reading the Markdown version get the
// prose and code around them instead.
const DEMOS = new Set(["HealPlayground"]);
// Previews keep their code block: the Markdown shows the document they render.
const PREVIEWS = new Set(["TypstPreview"]);

/**
 * `<TypstPreview>` renders the Typst code block inside it: copy the block's text into the
 * component's `source` prop, so the example is written once and shown both ways.
 */
function remarkTypstPreview() {
  return (tree: Root) => {
    const visit = (node: Nodes) => {
      if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "TypstPreview") {
        const code = node.children.find((child) => child.type === "code");
        if (code?.type === "code") node.attributes.push({ type: "mdxJsxAttribute", name: "source", value: code.value });
      }
      if ("children" in node) for (const child of node.children) visit(child as Nodes);
    };
    visit(tree);
  };
}

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: {
        headingIds: false,
        filterElement: (node: Nodes) => {
          if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return true;
          if (DEMOS.has(node.name ?? "")) return false;
          return PREVIEWS.has(node.name ?? "") ? "children-only" : true;
        },
      },
    },
  },
  meta: { schema: metaSchema },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [
      remarkTypstPreview,
      ...plugins,
      [remarkAutoTypeTable, { generator, options: typeTableOptions, remarkStringify: true }],
    ],
    rehypeCodeOptions: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
