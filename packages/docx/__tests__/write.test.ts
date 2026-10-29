// The writer on hand-made models. Whether Word-like engines lay the result out as Typst did is tools/docx-check's job
// (LibreOffice, and Microsoft's validator on every corpus document); this checks the OOXML itself.

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocxBlock, DocxMath, DocxMathRun, DocxModel, DocxParagraph, DocxPictureData } from "../src";
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

const parts = (m: DocxModel, fonts: Uint8Array[] = [FONT], pictures: DocxPictureData[] = []) => {
  const files = unzipSync(writeDocx(m, fonts, pictures));
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

  it("writes Typst's super and sub as Word's superscript and subscript, after the underline (CT_RPr's order)", () => {
    const para = p("", {
      runs: [
        { text: "cm", font: 0, size: 11 },
        { text: "2", font: 0, size: 11, script: "superscript", underline: true },
        { text: "2", font: 0, size: 11, script: "subscript" },
      ],
    });
    const doc = parts(model([para])).xml("word/document.xml");
    expect(doc).toContain(
      '<w:u w:val="single"/><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">2<',
    );
    expect(doc).toContain('<w:vertAlign w:val="subscript"/>');
  });

  it("keeps rules one after another apart, as LibreOffice would shade the gap between them", () => {
    const rule = { type: "rule", thickness: 0.4, color: "787878", indent: { left: 0, right: 0 } } as const;
    const doc = parts(model([{ ...rule }, { ...rule, before: 20 }])).xml("word/document.xml");
    const paragraphs = doc.match(/<w:p>.*?<\/w:p>/g) ?? [];
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]).not.toContain("<w:shd");
    expect(paragraphs[1]).toContain('w:before="399"');
    expect(paragraphs[2]).toContain('w:before="0"');
  });

  it("writes a tab stop's leader: an outline entry's dots", () => {
    const doc = parts(
      model([
        p("", {
          runs: [{ text: "Introduction", font: 0, size: 11 }, { tab: true }, { text: "1", font: 0, size: 11 }],
          tabs: [{ pos: 440, align: "end", leader: "dot" }],
        }),
      ]),
    ).xml("word/document.xml");
    expect(doc).toContain('<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8800"/></w:tabs>');
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

  describe("pictures", () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const data = (n: number): DocxPictureData[] =>
      Array.from({ length: n }, (_, i) => ({ svg: `<svg id="${i}"/>`, png: PNG }));
    const pictures = [
      { width: 100, height: 50, page: 0, x: 80, y: 120 },
      { width: 20, height: 12, page: 0, x: 200, y: 300 },
      { width: 40, height: 40, page: 0, x: 400, y: 600 },
    ];

    it("anchors a drawing's picture where its room starts, over a paragraph as tall, with SVG and PNG", () => {
      const { files, xml } = parts(
        model(
          [{ type: "drawing", width: 99, height: 49, indent: 10, before: 6, picture: { index: 0, x: -0.5, y: -0.5 } }],
          { pictures },
        ),
        [FONT],
        data(1),
      );
      const doc = xml("word/document.xml");
      // The room: an exact line as tall, indented; the picture in front of the text, from its anchor's line.
      expect(doc).toContain('w:line="980" w:lineRule="exact"');
      expect(doc).toContain('<w:ind w:left="200"/>');
      expect(doc).toMatch(
        /<wp:anchor [^>]*behindDoc="0"[^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="character"><wp:posOffset>-6350<\/wp:posOffset><\/wp:positionH><wp:positionV relativeFrom="line"><wp:posOffset>-6350<\/wp:posOffset><\/wp:positionV><wp:extent cx="1270000" cy="635000"\/><wp:effectExtent l="0" t="0" r="0" b="0"\/><wp:wrapNone\/><wp:docPr id="1"/,
      );
      // The PNG is the picture, the SVG its extension; both in media, with their content types.
      const rels = xml("word/_rels/document.xml.rels");
      const png = /<a:blip r:embed="(\w+)">/.exec(doc)?.[1];
      const svg = /<asvg:svgBlip [^>]*r:embed="(\w+)"/.exec(doc)?.[1];
      expect(rels).toContain(
        `Id="${png}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture1.png"`,
      );
      expect(rels).toContain(
        `Id="${svg}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture1.svg"`,
      );
      expect(files["word/media/picture1.png"]).toEqual(PNG);
      expect(xml("word/media/picture1.svg")).toBe('<svg id="0"/>');
      const types = xml("[Content_Types].xml");
      expect(types).toContain('<Default Extension="png" ContentType="image/png"/>');
      expect(types).toContain('<Default Extension="svg" ContentType="image/svg+xml"/>');
    });

    it("sets a picture in a line as a character, its bottom raised to where Typst drew it", () => {
      const doc = parts(
        model(
          [
            p("", {
              runs: [
                { text: "Tick ", font: 0, size: 11 },
                { gap: 20, font: 0, size: 11, picture: { index: 1, y: -10 } },
              ],
            }),
          ],
          {
            pictures,
          },
        ),
        [FONT],
        data(2),
      ).xml("word/document.xml");
      // Its top 10 pt above the baseline, 12 pt tall: its bottom 2 pt below, 4 half points.
      expect(doc).toContain(
        '<w:r><w:rPr><w:position w:val="-4"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:drawing><wp:inline',
      );
      expect(doc).toContain('<wp:extent cx="254000" cy="152400"/>');
      expect(doc).not.toContain("&#160;");
    });

    it("anchors a placed picture to the page, in the paragraph after it or, when that is on a later page, before it", () => {
      const placed = (index: number, host?: "previous"): DocxBlock => ({
        type: "drawing",
        width: 40,
        height: 40,
        indent: 0,
        placed: true,
        host,
        picture: { index, x: 0, y: 0 },
      });
      const doc = parts(
        model([placed(2), p("After"), p("Last"), placed(0, "previous")], { pictures }),
        [FONT],
        data(3),
      ).xml("word/document.xml");
      // No paragraph of its own: it takes no room.
      expect(doc.match(/<w:p>/g)).toHaveLength(2);
      const [after, last] = doc.split("<w:p>").slice(1) as [string, string];
      expect(after).toMatch(/<wp:positionH relativeFrom="page"><wp:posOffset>5080000<\/wp:posOffset>.*>After</);
      expect(last).toMatch(/>Last<.*<wp:positionV relativeFrom="page"><wp:posOffset>1524000</);
    });

    it("gives each part its own relationships to the pictures it shows, and numbers pictures across the document", () => {
      const m = model([{ type: "drawing", width: 100, height: 50, indent: 0, picture: { index: 0, x: 0, y: 0 } }], {
        pictures,
      });
      (m.sections[0] as DocxModel["sections"][number]).header = [
        { type: "drawing", width: 100, height: 50, indent: 0, picture: { index: 0, x: 0, y: 0 } },
      ];
      const { xml } = parts(m, [FONT], data(1));
      expect(xml("word/_rels/header1.xml.rels")).toContain('Target="media/picture1.png"');
      const ids = [...(xml("word/document.xml") + xml("word/header1.xml")).matchAll(/<wp:docPr id="(\d+)"/g)].map(
        (m) => m[1],
      );
      expect(new Set(ids).size).toBe(2);
    });

    it("holds the room without a picture when the model has no data for it", () => {
      const doc = parts(
        model([{ type: "drawing", width: 100, height: 50, indent: 0, picture: { index: 0, x: 0, y: 0 } }], {
          pictures,
        }),
      ).xml("word/document.xml");
      expect(doc).not.toContain("<w:drawing>");
      expect(doc).toContain('w:line="1000" w:lineRule="exact"');
    });
  });

  it("repeats the footer on a first page whose header differs, as titlePg switches both", () => {
    const m = model([p("x")]);
    const section = m.sections[0] as DocxModel["sections"][number];
    section.header = [p("Running head")];
    section.headerFirst = [];
    section.footer = [p("Page")];
    const { xml } = parts(m);
    const doc = xml("word/document.xml");
    expect(doc).toContain("<w:titlePg/>");
    expect(doc).toContain('<w:footerReference w:type="first"');
    const first = /<w:footerReference w:type="first" r:id="(\w+)"/.exec(doc)?.[1];
    const target = new RegExp(`Id="${first}"[^>]*Target="([^"]+)"`).exec(xml("word/_rels/document.xml.rels"))?.[1];
    expect(xml(`word/${target}`)).toContain(">Page<");
  });

  it("writes columns as a section of their own, continuous, with a column break between them", () => {
    const doc = parts(
      model([p("Before"), { type: "columns", gap: 20, columns: [[p("Left")], [p("Right")]] }, p("After")]),
    ).xml("word/document.xml");
    const sects = doc.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? [];
    // The text before (one column), the columns, and the rest (the body's own), all on the same page: the sections
    // after the first start where the one before ended.
    expect(sects).toHaveLength(3);
    for (const s of sects.slice(1)) expect(s).toContain('<w:type w:val="continuous"/>');
    expect(sects[1]).toContain('<w:cols w:num="2" w:space="400"/>');
    expect(doc.indexOf("Left")).toBeLessThan(doc.indexOf('<w:br w:type="column"/>'));
    expect(doc.indexOf('<w:br w:type="column"/>')).toBeLessThan(doc.indexOf("Right"));
    expect(doc).not.toContain("\u0001");
  });

  it("starts a section on a new page where the page numbering changes, numbered as Typst numbers it", () => {
    const m = model([p("Contents"), p("Introduction", { pageNumbering: { format: "decimal", start: 1 } })]);
    const section = m.sections[0] as DocxModel["sections"][number];
    section.pageNumbering = { format: "lowerRoman", start: 1 };
    section.footer = [p("", { runs: [{ text: "0", font: 0, size: 11, field: "PAGE" }] })];
    const doc = parts(m).xml("word/document.xml");
    const sects = doc.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? [];
    expect(sects).toHaveLength(2);
    // The front matter's section ends in its last paragraph, numbered in roman numerals.
    const contents = /<w:p>(?:(?!<w:p>).)*Contents<\/w:t><\/w:r><\/w:p>/.exec(doc)?.[0] ?? "";
    expect(contents).toContain("<w:sectPr>");
    expect(doc.match(/<w:p>/g)).toHaveLength(2);
    expect(sects[0]).toContain('<w:pgNumType w:fmt="lowerRoman" w:start="1"/>');
    expect(sects[1]).toContain('<w:type w:val="nextPage"/>');
    expect(sects[1]).toContain('<w:pgNumType w:fmt="decimal" w:start="1"/>');
    // Both sections show the footer: the same reference in each.
    for (const s of sects) expect(s).toContain('<w:footerReference w:type="default"');
  });

  it("writes placed text as a frame at its page position, in the schema's order", () => {
    const doc = parts(model([p("¶1", { frame: { x: 50, y: 120, width: 12, height: 10.4 } })])).xml("word/document.xml");
    expect(doc).toContain(
      '<w:framePr w:w="240" w:h="208" w:hRule="exact" w:wrap="through" w:hAnchor="page" w:vAnchor="page" w:x="1000" w:y="2400"/>',
    );
    const pPr = /<w:pPr>(.*?)<\/w:pPr>/.exec(doc)?.[1] as string;
    expect(pPr.indexOf("framePr")).toBeLessThan(pPr.indexOf("spacing"));
  });

  it("splits a table at a row that starts a page, repeating its header rows after the break", () => {
    const cell = (text: string) => ({
      col: 0,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      borders: {},
      blocks: [p(text)],
    });
    const doc = parts(
      model([
        {
          type: "table",
          indent: 0,
          columns: [100],
          rows: [
            { cantSplit: true, header: true, cells: [cell("Head")] },
            { cantSplit: true, cells: [cell("One")] },
            { cantSplit: true, pageBreak: true, cells: [cell("Two")] },
          ],
        },
      ]),
    ).xml("word/document.xml");
    expect(doc.match(/<w:tbl>/g)).toHaveLength(2);
    expect(doc.match(/>Head</g)).toHaveLength(2);
    const second = doc.slice(doc.lastIndexOf("<w:tbl>"));
    expect(second.indexOf("Head")).toBeLessThan(second.indexOf("Two"));
    expect(doc.slice(doc.indexOf("One"), doc.lastIndexOf("<w:tbl>"))).toContain("<w:pageBreakBefore/>");
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

  describe("equations (#132)", () => {
    const MATH_FONT = { name: "New Computer Modern Math", bold: false, italic: false, nbsp: 0.25 };
    const r = (text: string, sty: "p" | "i" = "i"): DocxMath => ({ t: "r", text, sty });
    const equation = (math: DocxMath[], extra: Partial<DocxMathRun> = {}): DocxMathRun => ({
      math,
      font: 1,
      size: 11,
      ...extra,
    });
    const doc = (blocks: DocxBlock[]) => {
      const m = model(blocks);
      m.fonts.push(MATH_FONT);
      return parts(m, [FONT, FONT]);
    };
    const body = (math: DocxMath[]) =>
      (
        /<m:oMath>(.*)<\/m:oMath>/.exec(
          doc([p("", { runs: [{ text: "x ", font: 0, size: 11 }, equation(math)] })]).xml("word/document.xml"),
        )?.[1] ?? ""
      ).replace(/<w:rPr>.*?<\/w:rPr>/g, "");

    it("writes an inline equation in its line, in the math font, which the settings declare", () => {
      const { xml } = doc([p("", { runs: [{ text: "Area ", font: 0, size: 11 }, equation([r("x")])] })]);
      const document = xml("word/document.xml");
      expect(document).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
      expect(document).toMatch(
        /<m:oMath><m:r><m:rPr><m:sty m:val="i"\/><\/m:rPr><w:rPr><w:rFonts w:ascii="New Computer Modern Math"/,
      );
      expect(xml("word/settings.xml")).toContain(
        '</w:compat><m:mathPr><m:mathFont m:val="New Computer Modern Math"/></m:mathPr>',
      );
    });

    it("writes a display equation in a paragraph of its own, aligned as the paragraph", () => {
      const document = doc([p("", { align: "center", runs: [equation([r("x")], { display: true })] })]).xml(
        "word/document.xml",
      );
      expect(document).toContain('<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>');
      expect(document).not.toContain("\u200b");
    });

    it("keeps an inline equation alone in its paragraph inline with a zero-width space", () => {
      const document = doc([p("", { runs: [equation([r("x")])] })]).xml("word/document.xml");
      expect(document).toContain("</m:oMath><w:r>");
      expect(document).toContain("\u200b</w:t>");
    });

    it("writes each structure's properties first and its arguments in the schema's order", () => {
      expect(body([{ t: "f", type: "noBar", num: [r("n")], den: [r("k")] }])).toBe(
        '<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num><m:r><m:rPr><m:sty m:val="i"/></m:rPr><m:t xml:space="preserve">n</m:t></m:r></m:num>' +
          '<m:den><m:r><m:rPr><m:sty m:val="i"/></m:rPr><m:t xml:space="preserve">k</m:t></m:r></m:den></m:f>',
      );
      expect(body([{ t: "s", e: [r("x")], sub: [r("1", "p")], sup: [r("2", "p")] }])).toMatch(
        /^<m:sSubSup><m:e>.*<\/m:e><m:sub>.*<\/m:sub><m:sup>.*<\/m:sup><\/m:sSubSup>$/,
      );
      expect(body([{ t: "s", pre: true, e: [r("C")], sub: [r("6", "p")], sup: [r("14", "p")] }])).toMatch(
        /^<m:sPre><m:sub>.*<\/m:sub><m:sup>.*<\/m:sup><m:e>.*<\/m:e><\/m:sPre>$/,
      );
      expect(body([{ t: "nary", chr: "∑", limits: true, sub: [r("i")], e: [r("i")] }])).toMatch(
        /^<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><m:supHide m:val="1"\/><\/m:naryPr><m:sub>.*<\/m:sub><m:sup><\/m:sup><m:e>.*<\/m:e><\/m:nary>$/,
      );
      expect(
        body([{ t: "func", name: [{ t: "lim", below: true, e: [r("lim", "p")], lim: [r("x")] }], e: [r("x")] }]),
      ).toMatch(
        /^<m:func><m:fName><m:limLow><m:e>.*<\/m:e><m:lim>.*<\/m:lim><\/m:limLow><\/m:fName><m:e>.*<\/m:e><\/m:func>$/,
      );
      // A square root's degree is there, hidden.
      expect(body([{ t: "rad", e: [r("2", "p")] }])).toMatch(
        /^<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr><m:deg><\/m:deg><m:e>.*<\/m:e><\/m:rad>$/,
      );
      expect(body([{ t: "d", open: "{", close: "", e: [r("x")] }])).toMatch(
        /^<m:d><m:dPr><m:begChr m:val="\{"\/><m:endChr m:val=""\/><\/m:dPr><m:e>.*<\/m:e><\/m:d>$/,
      );
      expect(body([{ t: "acc", chr: "\u0302", e: [r("x")] }])).toMatch(
        /^<m:acc><m:accPr><m:chr m:val="\u0302"\/><\/m:accPr>/,
      );
      expect(body([{ t: "bar", top: true, e: [r("z")] }])).toMatch(/^<m:bar><m:barPr><m:pos m:val="top"\/><\/m:barPr>/);
      expect(body([{ t: "groupChr", chr: "⏞", top: true, e: [r("a")] }])).toMatch(
        /^<m:groupChr><m:groupChrPr><m:chr m:val="⏞"\/><m:pos m:val="top"\/><m:vertJc m:val="bot"\/><\/m:groupChrPr>/,
      );
      expect(body([{ t: "box", strike: "bltr", e: [r("x")] }])).toMatch(
        /^<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"\/><m:hideBot m:val="1"\/><m:hideLeft m:val="1"\/><m:hideRight m:val="1"\/><m:strikeBLTR m:val="1"\/><\/m:borderBoxPr>/,
      );
    });

    it("writes a matrix's columns, its gap, and empty cells LibreOffice keeps", () => {
      const m = body([
        {
          t: "m",
          rows: [
            [[r("a")], [r("=b", "p")]],
            [[], [r("=c", "p")]],
          ],
          align: ["right", "left"],
          gap: 0,
        },
      ]);
      expect(m).toContain(
        '<m:mPr><m:cGpRule m:val="3"/><m:cGp m:val="0"/><m:mcs><m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="right"/></m:mcPr></m:mc>' +
          '<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="left"/></m:mcPr></m:mc></m:mcs></m:mPr>',
      );
      expect(m.match(/<m:mr>/g)).toHaveLength(2);
      expect(m).toContain('<m:t xml:space="preserve">\u200b</m:t>');
    });

    it("writes normal text and Word's alphabets as run properties", () => {
      expect(body([{ t: "r", text: "if", nor: true }])).toContain("<m:rPr><m:nor/></m:rPr>");
      expect(body([{ t: "r", text: "R", sty: "p", scr: "double-struck" }])).toContain(
        '<m:rPr><m:scr m:val="double-struck"/><m:sty m:val="p"/></m:rPr>',
      );
    });
  });
});
