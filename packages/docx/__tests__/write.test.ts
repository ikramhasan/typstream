// The writer on hand-made models. Whether Word-like engines lay the result out as Typst did is tools/docx-check's job
// (LibreOffice, and Microsoft's validator on every corpus document); this checks the OOXML itself.

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocxBlock, DocxModel, DocxParagraph } from "../src";
import { writeDocx } from "../src";

const FONT = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));

const p = (text: string, extra: Partial<DocxParagraph> = {}): DocxParagraph => ({
  type: "p",
  align: "start",
  indent: { left: 0, firstLine: 0 },
  pitch: 14.3,
  lines: 1,
  runs: [{ text, font: 0, size: 11 }],
  ...extra,
});

const model = (blocks: DocxBlock[], extra: Partial<DocxModel> = {}): DocxModel => ({
  fonts: [{ name: "Libertinus Serif", bold: false, italic: false, nbsp: 0.25 }],
  lists: [],
  sections: [
    { width: 595.28, height: 841.89, margin: { top: 70.87, right: 70.87, bottom: 70.87, left: 70.87 }, blocks },
  ],
  ...extra,
});

const parts = (m: DocxModel, fonts: Uint8Array[] = [FONT]) => {
  const files = unzipSync(writeDocx(m, fonts));
  return { files, xml: (name: string) => strFromU8(files[name] as Uint8Array) };
};

describe("writeDocx", () => {
  it("writes the parts a DOCX has, the content types first", () => {
    const { files, xml } = parts(model([p("Hello")]));
    expect(Object.keys(files)[0]).toBe("[Content_Types].xml");
    for (const name of [
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/settings.xml",
      "word/numbering.xml",
      "word/fontTable.xml",
      "word/_rels/document.xml.rels",
    ]) {
      expect(files[name], name).toBeDefined();
    }
    expect(xml("word/document.xml")).toContain('<w:t xml:space="preserve">Hello</w:t>');
    // The layout profile: exact line pitch in twips, Word 2013+ layout, no hyphenation.
    expect(xml("word/document.xml")).toContain('w:line="286" w:lineRule="exact"');
    expect(xml("word/settings.xml")).toContain('w:val="15"');
    expect(xml("word/settings.xml")).toContain('<w:autoHyphenation w:val="false"/>');
  });

  it("writes page size and margins in twips", () => {
    const { xml } = parts(model([p("x")]));
    expect(xml("word/document.xml")).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(xml("word/document.xml")).toContain('w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"');
  });

  it("embeds fonts obfuscated as ECMA-376 says, so XORing with the key gives the font back", () => {
    const { files, xml } = parts(model([p("x")]));
    const key = /w:fontKey="\{([0-9A-F-]+)\}"/.exec(xml("word/fontTable.xml"))?.[1] as string;
    const hex = key.replace(/-/g, "");
    const bytes = Array.from({ length: 16 }, (_, i) => Number.parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16));
    const stored = files["word/fonts/font1.odttf"] as Uint8Array;
    const restored = stored.map((b, i) => (i < 32 ? b ^ (bytes[i % 16] as number) : b));
    expect([...restored]).toEqual([...FONT]);
    expect(xml("word/fontTable.xml")).toContain('<w:font w:name="Libertinus Serif"><w:embedRegular');
  });

  it("writes paragraph properties in CT_PPrBase's order", () => {
    const { xml } = parts(
      model([p("Heading", { heading: 1, pageBreak: true, tabs: [{ pos: 400, align: "end" }], align: "center" })]),
    );
    const pPr = /<w:pPr>(.*?)<\/w:pPr>/.exec(xml("word/document.xml"))?.[1] as string;
    const order = [...pPr.matchAll(/<w:(\w+)/g)].map((m) => m[1]).filter((n) => n !== "tab");
    const schema = ["pStyle", "keepNext", "pageBreakBefore", "tabs", "spacing", "ind", "jc", "outlineLvl", "rPr"];
    const at = order.filter((n) => schema.includes(n as string)).map((n) => schema.indexOf(n as string));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("writes gaps as no-break spaces widened to the gap, tabs and line breaks as Word's", () => {
    const para = p("", {
      runs: [{ text: "a", font: 0, size: 11 }, { gap: 20, font: 0, size: 11 }, { tab: true }, { break: true }],
    });
    const doc = parts(model([para])).xml("word/document.xml");
    // 20pt = 400 twips, less the no-break space's 0.25em at 11pt (55 twips).
    expect(doc).toContain('<w:spacing w:val="345"/>');
    expect(doc).toContain("&#160;");
    expect(doc).toContain("<w:r><w:tab/></w:r>");
    expect(doc).toContain("<w:r><w:br/></w:r>");
  });

  it("writes a row span as a merge restarted and continued in the rows below", () => {
    const cell = (col: number, extra = {}) => ({
      col,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      borders: {},
      blocks: [p("c")],
      ...extra,
    });
    const doc = parts(
      model([
        {
          type: "table",
          indent: 0,
          columns: [100, 100],
          rows: [
            { cantSplit: true, cells: [cell(0, { rowSpan: 2 }), cell(1)] },
            { cantSplit: true, cells: [cell(1)] },
          ],
        },
      ]),
    ).xml("word/document.xml");
    expect(doc).toContain('<w:vMerge w:val="restart"/>');
    expect(doc).toContain("<w:vMerge/>");
    expect(doc.match(/<w:tc>/g)).toHaveLength(4);
    // Typst's widths, rounded up to twips; rows that don't split.
    expect(doc).toContain('<w:gridCol w:w="2000"/>');
    expect(doc).toContain("<w:cantSplit/>");
  });

  it("marks room held for equations and images with styles of its own", () => {
    const doc = parts(
      model([
        p("", { runs: [{ gap: 30, font: 0, size: 11, placeholder: true }] }),
        { type: "drawing", width: 100, height: 50, indent: 0, placeholder: true },
      ]),
    );
    expect(doc.xml("word/document.xml")).toContain('<w:rStyle w:val="TypstreamPlaceholder"/>');
    expect(doc.xml("word/document.xml")).toContain('<w:pStyle w:val="TypstreamPlaceholderBlock"/>');
    expect(doc.xml("word/styles.xml")).toContain('w:styleId="TypstreamPlaceholder"');
  });

  it("numbers list paragraphs from the list's numbering, its number in the hanging indent", () => {
    const doc = parts(
      model([p("First", { list: { id: 0, label: "1." } })], {
        lists: [
          { format: "decimal", text: "%1.", start: 1, align: "start", labelLeft: 0, labelRight: 7, bodyLeft: 13 },
        ],
      }),
    );
    expect(doc.xml("word/numbering.xml")).toContain('<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>');
    expect(doc.xml("word/document.xml")).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    expect(doc.xml("word/document.xml")).toContain('<w:ind w:left="260" w:hanging="260"/>');
  });
});
