// The layout profile (#129): every page the engine lays out keeps a constant line pitch, ragged right without
// hyphenation, whatever the document sets. Set rules lose to the profile's show-set rules; arguments that would win
// are taken out by heal's `layout-profile` lint before the document reaches the worker.

import type { PagedArtifact } from "@typstream/core";
import { afterAll, describe, expect, it } from "vitest";
import type { DocumentState } from "../src/document";
import { createEngine } from "../src/engine";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const engine = createEngine({ spawn: inProcess(() => nodeEngineWasm()), spare: false });
afterAll(() => engine.dispose());

const PAGE = "#set page(width: 9cm, height: auto, margin: 1cm)\n";
const BODY = `${"Typesetting a long paragraph of ordinary words breaks it into lines. ".repeat(6)}\n\nAnother paragraph.\n`;

/** The final pages of a document, as SVG. */
const pages = async (text: string, target: "paged" | "html" = "paged"): Promise<string[]> => {
  const doc = engine.open({ target, text });
  doc.finish();
  const state = await new Promise<DocumentState>((resolve) =>
    doc.subscribe((s) => (s.status === "done" || s.status === "error") && resolve(s)),
  );
  doc.dispose();
  expect(state.status).toBe("done");
  return target === "paged" ? (state.artifact as PagedArtifact).pages.map((p) => p.svg ?? "") : [];
};

describe("layout profile", () => {
  it("wins over a document's set rules: justification, hyphenation, leading, line breaking", async () => {
    const plain = await pages(PAGE + BODY);
    const set = await pages(
      `${PAGE}#set par(justify: true, leading: 1.5em, linebreaks: "optimized")\n#set text(hyphenate: true, top-edge: "bounds")\n${BODY}`,
    );
    expect(set).toEqual(plain);
    // Inside a template's show rule too.
    const template = await pages(
      `${PAGE}#show: doc => { set par(justify: true); set text(hyphenate: true); doc }\n${BODY}`,
    );
    expect(template).toEqual(plain);
  });

  it("wins over arguments and show-set rules, which heal's lint takes out", async () => {
    const plain = await pages(`${PAGE}#par[${BODY.split("\n\n")[0]}]\n\nAnother paragraph.\n`);
    const args = await pages(
      `${PAGE}#show par: set par(justify: true)\n#show text: set text(hyphenate: true)\n#par(justify: true, leading: 2em)[${BODY.split("\n\n")[0]}]\n\nAnother paragraph.\n`,
    );
    expect(args).toEqual(plain);
  });

  it("leaves spacing to the document", async () => {
    const plain = await pages(PAGE + BODY);
    expect(await pages(`${PAGE}#set par(spacing: 2em)\n${BODY}`)).not.toEqual(plain);
  });
});
