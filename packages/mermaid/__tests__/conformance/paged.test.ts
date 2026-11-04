/// <reference lib="dom" />
// mermaid's examples in the paged view equal their PDF (#135), and the HTML target shows them as the paged view does.
// Both would hold for code blocks too, so first: the real worker imports the generator and the pages draw diagrams.

import { htmlConformance } from "@typstream/conformance/html";
import { pagedConformance } from "@typstream/conformance/paged";
import type { PagedArtifact } from "@typstream/core";
import { createEngine, type DocumentState, engineWorker } from "@typstream/engine";
import { expect, it } from "vitest";
import { suite } from "./suite";

it("draws diagrams in the engine's worker", { timeout: 60_000 }, async () => {
  const engine = createEngine({ spawn: engineWorker(), spare: false });
  try {
    const doc = engine.open({ plugins: suite.plugins, target: "paged", text: suite.examples[0]?.source ?? "" });
    doc.finish();
    const state = await new Promise<DocumentState>((resolve) => {
      const check = (s: DocumentState) => (s.status === "done" || s.status === "error") && resolve(s);
      doc.subscribe(check);
      check(doc.getState());
    });
    expect(state.status).toBe("done");
    const svg = (state.artifact as PagedArtifact).pages.map((p) => p.svg).join("");
    // The diagram's shapes, as the SVG image the generator wrote.
    expect(svg).toMatch(/<image[^>]+href="data:image\/svg\+xml/);
  } finally {
    engine.dispose();
  }
});

pagedConformance(suite);
htmlConformance(suite);
