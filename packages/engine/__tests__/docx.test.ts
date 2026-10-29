// DOCX exports through the engine (#131): the server compiles pages into engine-wasm's document model, with the margin
// probe after the document, and @typstream/docx writes the file.

import { Engine } from "@typstream/engine-wasm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { DOCX_MARGIN_PROBE } from "../src/server/docx";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const engine = createEngine({ spawn: inProcess(() => nodeEngineWasm()), spare: false });
afterAll(() => engine.dispose());

const exported = async (text: string): Promise<Record<string, string>> => {
  const doc = engine.open({ target: "paged", text });
  doc.finish();
  const bytes = await doc.exportDocx();
  doc.dispose();
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([k, v]) => [k, k.endsWith(".odttf") ? "" : strFromU8(v)]),
  );
};

describe("exportDocx", () => {
  it("writes the document's paragraphs, lists and tables, its fonts embedded", async () => {
    const files = await exported(
      '#set page(paper: "us-letter", margin: (x: 2cm, y: 2.5cm))\n= Fractions\nAdd *both* parts.\n\n+ First\n+ Second\n\n#table(columns: 2, [a], [b])\n',
    );
    const doc = files["word/document.xml"] as string;
    for (const text of ["Fractions", "Add ", "both", " parts.", "First", "Second", ">a<", ">b<"])
      expect(doc).toContain(text);
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("<w:numPr>");
    expect(doc).toContain("<w:tbl>");
    // US letter, the margins the document set (the probe read them): 2cm = 1134 twips, 2.5cm = 1417.
    expect(doc).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(doc).toContain('w:top="1417" w:right="1134" w:bottom="1417" w:left="1134"');
    expect(files["word/fontTable.xml"]).toContain("Libertinus Serif");
    expect(Object.keys(files).some((k) => k.startsWith("word/fonts/"))).toBe(true);
    // The server's probe is engine-wasm's (the wasm is initialized by now).
    expect(Engine.docx_margin_probe()).toBe(DOCX_MARGIN_PROBE);
  });

  it("writes equations as Word math, inline and display, and leaves the pages as they were", async () => {
    const text = '#set math.equation(numbering: "(1)")\nThe area is $3/4 x^2$.\n$ sum_(i=1)^n i = (n(n+1))/2 $\n';
    const doc = engine.open({ target: "paged", text });
    doc.finish();
    const before = await doc.exportPdf();
    const files = Object.fromEntries(
      Object.entries(unzipSync(await doc.exportDocx())).map(([k, v]) => [k, k.endsWith(".odttf") ? "" : strFromU8(v)]),
    );
    // The export's compile swaps Typst's rule for equations; the next compile has Typst's own again.
    expect(await doc.exportPdf()).toEqual(before);
    doc.dispose();
    const xml = files["word/document.xml"] as string;
    expect(xml).toContain("<m:oMath><m:f>");
    expect(xml).toContain('<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>');
    expect(xml).toContain("<m:oMathPara>");
    // The number beside the display equation, in a cell of its own.
    expect(xml).toContain(">(1)</w:t>");
    expect(xml).not.toContain('TypstreamPlaceholder"');
    // Typst's math font, as its file names its family.
    expect(files["word/settings.xml"]).toMatch(/<m:mathFont m:val="NewComputerModern ?Math"\/>/);
  });

  it("writes what Word can't draw as pictures, SVG with a PNG, from the worker (#133)", async () => {
    const files = await exported(
      "Above.\n\n#box(width: 3cm, height: 1cm, place(circle(radius: 0.4cm, fill: red)))\n\nBelow.\n",
    );
    const doc = files["word/document.xml"] as string;
    expect(doc).toContain("<wp:anchor ");
    expect(doc).toContain("<asvg:svgBlip ");
    expect(files["word/media/picture1.svg"]).toMatch(/^<svg /);
    expect(files["word/media/picture1.png"]?.slice(1, 4)).toBe("PNG");
    expect(files["[Content_Types].xml"]).toContain('<Default Extension="svg" ContentType="image/svg+xml"/>');
  });

  it("rejects a document that doesn't compile, as the other exports do", async () => {
    const doc = engine.open({ target: "paged", text: "#nope" });
    doc.finish();
    await expect(doc.exportDocx()).rejects.toMatchObject({ reason: "diagnostics" });
    doc.dispose();
  });
});
