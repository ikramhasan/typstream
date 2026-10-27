import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { type NextRequest, NextResponse } from "next/server";
import { docsContentRoute, docsRoute } from "@/lib/shared";

// Every docs page has a Markdown twin for agents: `/docs/concepts/healing.md`, or the page's own URL
// requested with `Accept: text/markdown`.
const { rewrite: rewriteDocs } = rewritePath(`${docsRoute}{/*path}`, `${docsContentRoute}{/*path}/content.md`);
const { rewrite: rewriteSuffix } = rewritePath(`${docsRoute}{/*path}.md`, `${docsContentRoute}{/*path}/content.md`);

export default function proxy(request: NextRequest) {
  const suffixed = rewriteSuffix(request.nextUrl.pathname);
  if (suffixed) return NextResponse.rewrite(new URL(suffixed, request.nextUrl));

  if (isMarkdownPreferred(request)) {
    const negotiated = rewriteDocs(request.nextUrl.pathname);
    if (negotiated) {
      // This URL has two representations, selected by `Accept`.
      return NextResponse.rewrite(new URL(negotiated, request.nextUrl), { headers: { Vary: "Accept" } });
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ["/docs", "/docs.md", "/docs/:path*"] };
