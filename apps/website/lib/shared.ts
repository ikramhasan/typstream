import { createGetUrl } from "fumadocs-core/source";

export const appName = "typstream";
export const tagline = "Render Typst streamed from an LLM, live.";
export const description =
  "typstream heals, compiles and renders Typst while a language model is still writing it: every token, a document that compiles, in the browser or on the server.";
export const docsRoute = "/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = { user: "ikramhasan", repo: "typstream", branch: "main" };
export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/**
 * The deployed AI SDK example (examples/nextjs-ai-sdk): a chat that streams Claude's answers into
 * `<Typstream>`, with the visitor's own key. A pull request's preview of this site links to that pull
 * request's preview of the example (NEXT_PUBLIC_DEMO_URL, set by .github/workflows/deploy.yml).
 */
export const demoUrl = process.env.NEXT_PUBLIC_DEMO_URL || "https://typstream-ai-sdk.vercel.app";

/**
 * The site's own origin, for absolute links in llms.txt and metadata. Unset in local builds, where
 * links stay relative to whatever served them.
 */
export const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");

const getContentUrl = createGetUrl(docsContentRoute);

/** Where a page's Markdown is served: the `.md` route rewrites to it (proxy.ts). */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];
  return { segments, url: getContentUrl(segments, page.locale) };
}

/** The public `.md` address of a page: `/docs/concepts/healing.md`, and `/docs.md` for the root page. */
export function markdownPath(url: string): string {
  return `${url.replace(/\/$/, "")}.md`;
}
