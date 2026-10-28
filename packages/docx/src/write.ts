// OOXML from the document model (#131): word/document.xml and its parts, under the layout profile (#129) that makes
// Word-like engines break lines and pages where Typst did (#118's spike, spikes/docx/writers.py). Every length in the
// model is in points; OOXML wants twentieths of a point (twips), half points for text sizes and eighths of a point for
// borders. Child elements are written in the order the schema fixes: Word reports any other order as unreadable
// content, where LibreOffice and ONLYOFFICE take it.

import { zipSync } from "fflate";
import type {
  DocxBlock,
  DocxCell,
  DocxColumns,
  DocxDrawing,
  DocxFont,
  DocxGapRun,
  DocxModel,
  DocxParagraph,
  DocxRule,
  DocxRun,
  DocxSection,
  DocxTable,
  DocxTextRun,
} from "./model";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const twips = (pt: number): number => Math.round(pt * 20);
/** Room given back in a cell, in points (see `cell`). */
const SLACK = 1;
/** Marks where a section's properties go in the body, written once the headers' references are known. */
const SECTION = "\u0001";
/** Styles marking room held for equations and images until the export writes them (#132, #133). */
const PLACEHOLDER = "TypstreamPlaceholder";
const PLACEHOLDER_BLOCK = "TypstreamPlaceholderBlock";
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
/** Text sizes are half points: Typst's are rounded to them (edu sets them so, #130). */
const halfPoints = (pt: number): number => Math.max(2, Math.round(pt * 2));
/** Border widths are eighths of a point, from 2 to 96. */
const eighths = (pt: number): number => Math.min(96, Math.max(2, Math.round(pt * 8)));

/** What a part being written refers to: hyperlinks need relationships of their own. */
interface Part {
  rels: string[];
}

class Writer {
  constructor(
    private readonly model: DocxModel,
    private readonly fonts: readonly DocxFont[],
  ) {}

  private rPr(
    font: number,
    size: number,
    color?: string,
    underline?: boolean,
    spacing?: number,
    style?: string,
  ): string {
    const f = this.fonts[font];
    const name = esc(f?.name ?? "Libertinus Serif");
    let x = style ? `<w:rStyle w:val="${style}"/>` : "";
    x += `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}" w:eastAsia="${name}"/>`;
    if (f?.bold) x += "<w:b/><w:bCs/>";
    if (f?.italic) x += "<w:i/><w:iCs/>";
    if (color) x += `<w:color w:val="${color}"/>`;
    if (spacing) x += `<w:spacing w:val="${spacing}"/>`;
    const sz = halfPoints(size);
    x += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
    if (underline) x += '<w:u w:val="single"/>';
    return `<w:rPr>${x}</w:rPr>`;
  }

  private run(r: DocxRun, part: Part): string {
    if ("break" in r) return "<w:r><w:br/></w:r>";
    if ("tab" in r) return "<w:r><w:tab/></w:r>";
    if ("gap" in r) {
      // A no-break space, widened to the gap by character spacing: exact to a twip, and Word underlines the spacing too.
      const nbsp = (this.fonts[r.font]?.nbsp ?? 0.25) * halfPoints(r.size) * 10;
      const spacing = Math.max(0, twips(r.gap) - Math.round(nbsp));
      const style = r.placeholder ? PLACEHOLDER : undefined;
      // U+00A0, written as a character reference so it stays visible in the source.
      return `<w:r>${this.rPr(r.font, r.size, undefined, r.underline, spacing, style)}<w:t xml:space="preserve">&#160;</w:t></w:r>`;
    }
    const run = `<w:r>${this.rPr(r.font, r.size, r.color, r.underline)}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    if (r.field) return `<w:fldSimple w:instr="${r.field}">${run}</w:fldSimple>`;
    if (r.link) {
      const id = `rIdLink${part.rels.length + 1}`;
      part.rels.push(`<Relationship Id="${id}" Type="${REL}hyperlink" Target="${esc(r.link)}" TargetMode="External"/>`);
      return `<w:hyperlink r:id="${id}">${run}</w:hyperlink>`;
    }
    return run;
  }

  /** Paragraph properties, in CT_PPrBase's order. */
  private pPr(o: {
    style?: string;
    keepNext?: boolean;
    pageBreak?: boolean;
    frame?: DocxParagraph["frame"];
    num?: number;
    border?: string;
    tabs?: { pos: number; align: "start" | "end" }[];
    before?: number;
    after?: number;
    line: number;
    atLeast?: boolean;
    left?: number;
    firstLine?: number;
    right?: number;
    jc?: string;
    outline?: number;
    rPr?: string;
  }): string {
    let x = "";
    if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
    if (o.keepNext) x += "<w:keepNext/>";
    if (o.pageBreak) x += "<w:pageBreakBefore/>";
    // Placed text: a frame where Typst put it on the page; the text flows through it as if it weren't there.
    if (o.frame)
      x +=
        `<w:framePr w:w="${twips(o.frame.width)}" w:h="${twips(o.frame.height)}" w:hRule="exact" w:wrap="through" ` +
        `w:hAnchor="page" w:vAnchor="page" w:x="${twips(o.frame.x)}" w:y="${twips(o.frame.y)}"/>`;
    if (o.num !== undefined) x += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.num}"/></w:numPr>`;
    if (o.border) x += o.border;
    if (o.tabs?.length)
      x += `<w:tabs>${o.tabs.map((t) => `<w:tab w:val="${t.align === "end" ? "right" : "left"}" w:pos="${twips(t.pos)}"/>`).join("")}</w:tabs>`;
    x += `<w:spacing w:before="${Math.max(0, twips(o.before ?? 0))}" w:after="${Math.max(0, twips(o.after ?? 0))}" w:line="${Math.max(1, twips(o.line))}" w:lineRule="${o.atLeast ? "atLeast" : "exact"}"/>`;
    const first = o.firstLine ?? 0;
    const ind = [
      `w:left="${twips(o.left ?? 0)}"`,
      o.right ? `w:right="${twips(o.right)}"` : "",
      first > 0 ? `w:firstLine="${twips(first)}"` : first < 0 ? `w:hanging="${twips(-first)}"` : "",
    ].filter(Boolean);
    x += `<w:ind ${ind.join(" ")}/>`;
    if (o.jc) x += `<w:jc w:val="${o.jc}"/>`;
    if (o.outline !== undefined) x += `<w:outlineLvl w:val="${o.outline}"/>`;
    if (o.rPr) x += o.rPr;
    return `<w:pPr>${x}</w:pPr>`;
  }

  paragraph(p: DocxParagraph, part: Part, after?: number): string {
    const list = p.list ? this.model.lists[p.list.id] : undefined;
    const first = (p.runs.find((r) => "text" in r) ?? p.runs.find((r) => "gap" in r)) as
      | DocxTextRun
      | DocxGapRun
      | undefined;
    const mark = first ? this.rPr(first.font, first.size) : undefined;
    let left = p.indent.left;
    let firstLine = p.indent.firstLine;
    let num: number | undefined;
    let label = "";
    if (list && p.list) {
      // The number sits in the hanging indent: Word puts it there and tabs to the body.
      left = list.bodyLeft;
      firstLine = -(list.bodyLeft - (list.align === "end" ? list.labelRight : list.labelLeft));
      if (list.format === "none") {
        // Labels Word has no numbering for are text, then a tab to the body.
        label =
          this.run({ text: p.list.label, font: first?.font ?? 0, size: first?.size ?? 11 }, part) +
          "<w:r><w:tab/></w:r>";
      } else {
        num = p.list.id + 1;
      }
    }
    const jc = p.align === "center" ? "center" : p.align === "end" ? "right" : "left";
    const content = label + p.runs.map((r) => this.run(r, part)).join("");
    return `<w:p>${this.pPr({
      style: p.heading ? `Heading${Math.min(6, p.heading)}` : undefined,
      keepNext: p.heading !== undefined,
      pageBreak: p.pageBreak,
      frame: p.frame,
      num,
      tabs: p.tabs,
      before: p.before,
      after,
      line: p.pitch,
      atLeast: p.atLeast,
      left,
      right: p.indent.right,
      firstLine,
      jc,
      outline: p.heading ? Math.min(9, p.heading) - 1 : undefined,
      rPr: mark,
    })}${content}</w:p>`;
  }

  /** A paragraph holding space: exact height, nothing in it. */
  spacer(height: number, before = 0, pageBreak = false, left = 0, style?: string): string {
    return `<w:p>${this.pPr({ style, pageBreak, before, line: Math.max(0.05, height), left, rPr: '<w:rPr><w:sz w:val="2"/></w:rPr>' })}</w:p>`;
  }

  rule(r: DocxRule): string {
    const border = `<w:pBdr><w:bottom w:val="single" w:sz="${eighths(r.thickness)}" w:space="0" w:color="${r.color}"/></w:pBdr>`;
    return `<w:p>${this.pPr({
      pageBreak: r.pageBreak,
      border,
      before: r.before,
      line: 0.05,
      left: r.indent.left,
      right: r.indent.right,
      rPr: '<w:rPr><w:sz w:val="2"/></w:rPr>',
    })}</w:p>`;
  }

  drawing(d: DocxDrawing): string {
    return this.spacer(d.height, d.before, d.pageBreak, d.indent, d.placeholder ? PLACEHOLDER_BLOCK : undefined);
  }

  table(t: DocxTable, part: Part): string {
    // Widths rounded up (#118's spike): a column a hair narrower than Typst's would break its longest word.
    const cols = t.columns.map((w) => Math.max(20, Math.ceil(w * 20)));
    const total = cols.reduce((a, b) => a + b, 0);
    const pr =
      `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="${twips(t.indent)}" w:type="dxa"/>` +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      "</w:tblPr>";
    const grid = `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    // Cells a row span covers in the rows below: Word wants a continuing cell there.
    const spans = new Map<string, DocxCell>();
    const rows = t.rows.map((row, r) => {
      const cells = [...row.cells].sort((a, b) => a.col - b.col);
      let tcs = "";
      let col = 0;
      const width = (c: number, span: number) => cols.slice(c, c + span).reduce((a, b) => a + b, 0);
      const continuing = (c: number) => spans.get(`${r}:${c}`);
      while (col < cols.length) {
        const cell = cells.find((c) => c.col === col);
        const cont = continuing(col);
        if (cell) {
          const span = cell.span ?? 1;
          for (let k = 1; k < (cell.rowSpan ?? 1); k++) spans.set(`${r + k}:${col}`, cell);
          tcs += this.cell(cell, width(col, span), part, cell.rowSpan && cell.rowSpan > 1 ? "restart" : undefined);
          col += span;
        } else if (cont) {
          const span = cont.span ?? 1;
          tcs += this.cell({ ...cont, blocks: [] }, width(col, span), part, "continue");
          col += span;
        } else {
          tcs += this.cell(
            { col, margins: { top: 0, right: 0, bottom: 0, left: 0 }, borders: {}, blocks: [] },
            cols[col] ?? 0,
            part,
          );
          col += 1;
        }
      }
      const trPr = `<w:trPr>${row.cantSplit ? "<w:cantSplit/>" : ""}${row.header ? "<w:tblHeader/>" : ""}</w:trPr>`;
      return `<w:tr>${trPr}${tcs}</w:tr>`;
    });
    return `<w:tbl>${pr}${grid}${rows.join("")}</w:tbl>`;
  }

  private cell(c: DocxCell, width: number, part: Part, merge?: "restart" | "continue"): string {
    let pr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
    if (c.span && c.span > 1) pr += `<w:gridSpan w:val="${c.span}"/>`;
    if (merge) pr += merge === "restart" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>";
    const sides = (["top", "left", "bottom", "right"] as const)
      .map((s) => {
        const b = c.borders[s];
        return b ? `<w:${s} w:val="single" w:sz="${eighths(b.width)}" w:space="0" w:color="${b.color}"/>` : "";
      })
      .join("");
    if (sides) pr += `<w:tcBorders>${sides}</w:tcBorders>`;
    if (c.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>`;
    // A column Typst sized to its widest content (`auto`) fits it exactly, and a Word-like engine measures text a
    // hair wider: a cell whose paragraphs Typst set on one line each doesn't wrap, and every cell has up to a point
    // of slack on its right, which its text doesn't reach.
    const single = c.blocks.length > 0 && c.blocks.every((b) => b.type !== "p" || b.lines <= 1);
    if (single && c.blocks.some((b) => b.type === "p")) pr += "<w:noWrap/>";
    const m = c.margins;
    const right = Math.max(0, m.right - SLACK);
    pr +=
      `<w:tcMar><w:top w:w="${twips(m.top)}" w:type="dxa"/><w:left w:w="${twips(m.left)}" w:type="dxa"/>` +
      `<w:bottom w:w="${twips(m.bottom)}" w:type="dxa"/><w:right w:w="${twips(right)}" w:type="dxa"/></w:tcMar>`;
    if (c.valign) pr += `<w:vAlign w:val="${c.valign}"/>`;
    let body = this.blocks(c.blocks, part);
    // A cell ends with a paragraph; after a table, one that takes no room.
    if (!body.endsWith("</w:p>")) body += this.spacer(0.05);
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${body}</w:tc>`;
  }

  /** Blocks in order. A table has no space before: the paragraph before it gets it after, or a spacer holds it. */
  blocks(blocks: readonly DocxBlock[], part: Part): string {
    const out: string[] = [];
    blocks.forEach((b, i) => {
      const next = blocks[i + 1];
      const gapAfter = next?.type === "table" && b.type === "p" ? (next.before ?? 0) : undefined;
      switch (b.type) {
        case "p":
          out.push(this.paragraph(b, part, gapAfter));
          break;
        case "table": {
          const prev = blocks[i - 1];
          // Two tables in a row would merge into one: a paragraph between them, as tall as the gap.
          if (prev && prev.type !== "p") out.push(this.spacer(Math.max(0.05, b.before ?? 0)));
          else if (!prev && (b.before ?? 0) > 0.05) out.push(this.spacer(b.before ?? 0));
          if (b.pageBreak) out.push(this.spacer(0.05, 0, true));
          out.push(this.table(b, part));
          break;
        }
        case "rule":
          out.push(this.rule(b));
          break;
        case "drawing":
          out.push(this.drawing(b));
          break;
        case "columns":
          out.push(this.columns(b, part));
          break;
      }
    });
    return out.join("");
  }

  /** Whether the body has columns: its sections then follow each other on the page (continuous). */
  sectioned = false;

  /**
   * Columns as Word has them, in a section: a section break before (the text so far, one column), a column break
   * between columns, and a section break with the columns after. Breaks are paragraphs a hundredth of a point tall.
   * The section properties need the headers' references, written after the body: they stand in as markers here.
   */
  columns(c: DocxColumns, part: Part): string {
    this.sectioned = true;
    const tiny = '<w:rPr><w:sz w:val="2"/></w:rPr>';
    const brk = `<w:p>${this.pPr({ line: 0.05, rPr: tiny })}<w:r>${tiny}<w:br w:type="column"/></w:r></w:p>`;
    const end = (cols: number) =>
      `<w:p>${this.pPr({ line: 0.05, rPr: `${tiny}${SECTION}${cols}:${c.gap}${SECTION}` })}</w:p>`;
    // The space before goes on the first column's first block: an engine may drop an empty paragraph that ends a
    // section, its spacing with it.
    const [first = [], ...rest] = c.columns;
    const lead = first.map((b, i) => (i === 0 ? { ...b, before: (b.before ?? 0) + (c.before ?? 0) } : b));
    return (
      `<w:p>${this.pPr({ pageBreak: c.pageBreak, line: 0.05, rPr: `${tiny}${SECTION}1:0${SECTION}` })}</w:p>` +
      [lead, ...rest].map((col) => this.blocks(col, part)).join(brk) +
      end(c.columns.length)
    );
  }

  section(s: DocxSection, refs: string, cols = 1, gap = 0): string {
    const landscape = s.width > s.height ? ' w:orient="landscape"' : "";
    const m = s.margin;
    return (
      `<w:sectPr>${refs}${this.sectioned ? '<w:type w:val="continuous"/>' : ""}` +
      `<w:pgSz w:w="${twips(s.width)}" w:h="${twips(s.height)}"${landscape}/>` +
      `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" ` +
      `w:header="${twips(s.headerDistance ?? m.top / 2)}" w:footer="${twips(s.footerDistance ?? m.bottom / 2)}" w:gutter="0"/>` +
      (cols > 1 ? `<w:cols w:num="${cols}" w:space="${twips(gap)}"/>` : "") +
      (s.headerFirst || s.footerFirst ? "<w:titlePg/>" : "") +
      "</w:sectPr>"
    );
  }
}

/** A stable GUID for an embedded font: the key its obfuscation XORs with. */
const fontKey = (data: Uint8Array, index: number): Uint8Array => {
  const key = new Uint8Array(16);
  let h = 0x811c9dc5 ^ index;
  for (let i = 0; i < data.length; i += 997) {
    h = Math.imul(h ^ (data[i] as number), 0x01000193);
  }
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ i, 0x01000193);
    key[i] = (h >>> 24) & 0xff;
  }
  return key;
};

const guid = (k: Uint8Array): string => {
  const hex = [...k].map((b) => b.toString(16).padStart(2, "0").toUpperCase());
  return `{${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}}`;
};

/**
 * ECMA-376 Part 1, 17.8.1: the first 32 bytes XORed with the GUID's bytes, reversed from its string form, twice over.
 */
const obfuscate = (data: Uint8Array, key: Uint8Array): Uint8Array => {
  // The GUID string's hex digits read backwards, as bytes.
  const hex = guid(key).replace(/[{}-]/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16);
  const out = data.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] = (out[i] as number) ^ (bytes[i % 16] as number);
  return out;
};

const slot = (f: DocxFont): "Regular" | "Bold" | "Italic" | "BoldItalic" =>
  f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";

/**
 * A DOCX file from a document model and the fonts it names (their data in `model.fonts`' order), embedded so Word
 * sets the text in the faces Typst did.
 * @internal
 */
export const writeDocx = (model: DocxModel, fonts: readonly Uint8Array[]): Uint8Array => {
  const w = new Writer(model, model.fonts);
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  const section = model.sections[0];
  if (!section) throw new Error("docx: a document model has at least one section");
  const docPart: Part = { rels: [] };
  const body = w.blocks(section.blocks, docPart);

  // Headers and footers.
  const marginals: { kind: "header" | "footer"; type: "default" | "first"; blocks: DocxBlock[] }[] = [];
  // A different first page (titlePg) is one switch for both: the one that doesn't differ is repeated there.
  const titlePg = section.headerFirst !== undefined || section.footerFirst !== undefined;
  const headerFirst = section.headerFirst ?? (titlePg ? section.header : undefined);
  const footerFirst = section.footerFirst ?? (titlePg ? section.footer : undefined);
  if (section.header) marginals.push({ kind: "header", type: "default", blocks: section.header });
  if (headerFirst) marginals.push({ kind: "header", type: "first", blocks: headerFirst });
  if (section.footer) marginals.push({ kind: "footer", type: "default", blocks: section.footer });
  if (footerFirst) marginals.push({ kind: "footer", type: "first", blocks: footerFirst });
  if ((section.headerFirst || section.footerFirst) && !section.header)
    marginals.push({ kind: "header", type: "default", blocks: [] });
  let refs = "";
  const overrides: string[] = [];
  marginals.forEach((m, i) => {
    const part: Part = { rels: [] };
    const name = `${m.kind}${i + 1}.xml`;
    const tag = m.kind === "header" ? "hdr" : "ftr";
    let content = w.blocks(
      m.blocks.map((b) => ({ ...b, before: 0 })),
      part,
    );
    if (!content.endsWith("</w:p>")) content += w.spacer(0.05);
    files[`word/${name}`] = enc.encode(`${XML}<w:${tag} ${NS}>${content}</w:${tag}>`);
    if (part.rels.length)
      files[`word/_rels/${name}.rels`] = enc.encode(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${part.rels.join("")}</Relationships>`,
      );
    const id = `rIdM${i + 1}`;
    docPart.rels.push(`<Relationship Id="${id}" Type="${REL}${m.kind}" Target="${name}"/>`);
    overrides.push(
      `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${m.kind}+xml"/>`,
    );
  });
  // References: headers first, then footers (CT_SectPr).
  for (const kind of ["header", "footer"] as const)
    marginals.forEach((m, i) => {
      if (m.kind === kind) refs += `<w:${kind}Reference w:type="${m.type}" r:id="rIdM${i + 1}"/>`;
    });

  const sections = body.replace(
    new RegExp(`${SECTION}(\\d+):([\\d.]+)${SECTION}`, "g"),
    (_, cols: string, gap: string) => w.section(section, refs, Number(cols), Number(gap)),
  );
  files["word/document.xml"] = enc.encode(
    `${XML}<w:document ${NS}><w:body>${sections}${w.section(section, refs)}</w:body></w:document>`,
  );

  // Styles: defaults for empty paragraphs, and headings for the outline (runs carry their own fonts and sizes).
  const base = esc(model.fonts[0]?.name ?? "Libertinus Serif");
  const headings = [1, 2, 3, 4, 5, 6]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/>` +
        `<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`,
    )
    .join("");
  files["word/styles.xml"] = enc.encode(
    `${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="${base}" w:hAnsi="${base}" w:cs="${base}" w:eastAsia="${base}"/>` +
      '<w:kern w:val="2"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/><w14:ligatures w14:val="standard"/>' +
      "</w:rPr></w:rPrDefault>" +
      '<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:before="0" w:after="0" w:line="286" w:lineRule="exact"/></w:pPr></w:pPrDefault>' +
      "</w:docDefaults>" +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      headings +
      `<w:style w:type="character" w:styleId="${PLACEHOLDER}"><w:name w:val="Typstream placeholder"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="${PLACEHOLDER_BLOCK}"><w:name w:val="Typstream placeholder block"/><w:basedOn w:val="Normal"/></w:style>` +
      "</w:styles>",
  );

  // Numbering: one abstract numbering and one instance per list.
  const abstract = model.lists
    .map((l, i) => {
      const hanging = Math.max(0, l.bodyLeft - (l.align === "end" ? l.labelRight : l.labelLeft));
      return (
        `<w:abstractNum w:abstractNumId="${i}"><w:multiLevelType w:val="singleLevel"/>` +
        `<w:lvl w:ilvl="0"><w:start w:val="${l.start}"/><w:numFmt w:val="${l.format === "none" ? "decimal" : l.format}"/>` +
        `<w:lvlText w:val="${esc(l.text)}"/><w:lvlJc w:val="${l.align === "end" ? "right" : "left"}"/>` +
        `<w:pPr><w:ind w:left="${twips(l.bodyLeft)}" w:hanging="${twips(hanging)}"/></w:pPr>` +
        `<w:rPr><w:rFonts w:ascii="${base}" w:hAnsi="${base}" w:cs="${base}"/></w:rPr></w:lvl></w:abstractNum>`
      );
    })
    .join("");
  const nums = model.lists.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i}"/></w:num>`).join("");
  files["word/numbering.xml"] = enc.encode(`${XML}<w:numbering ${NS}>${abstract}${nums}</w:numbering>`);

  files["word/settings.xml"] = enc.encode(
    `${XML}<w:settings ${NS}><w:embedTrueTypeFonts/><w:defaultTabStop w:val="720"/>` +
      '<w:autoHyphenation w:val="false"/><w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      "</w:settings>",
  );

  // Fonts: each family with its faces embedded in their slots.
  const families = new Map<string, { slot: string; index: number }[]>();
  model.fonts.forEach((f, i) => {
    const list = families.get(f.name) ?? [];
    if (!list.some((s) => s.slot === slot(f))) list.push({ slot: slot(f), index: i });
    families.set(f.name, list);
  });
  const fontRels: string[] = [];
  let fontTable = "";
  for (const [name, faces] of families) {
    const order = ["Regular", "Bold", "Italic", "BoldItalic"];
    const embeds = faces
      .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
      .map(({ slot, index }) => {
        const data = fonts[index];
        if (!data) return "";
        const key = fontKey(data, index);
        const id = `rIdFont${index + 1}`;
        files[`word/fonts/font${index + 1}.odttf`] = obfuscate(data, key);
        fontRels.push(`<Relationship Id="${id}" Type="${REL}font" Target="fonts/font${index + 1}.odttf"/>`);
        return `<w:embed${slot} r:id="${id}" w:fontKey="${guid(key)}"/>`;
      })
      .join("");
    fontTable += `<w:font w:name="${esc(name)}">${embeds}</w:font>`;
  }
  files["word/fontTable.xml"] = enc.encode(`${XML}<w:fonts ${NS}>${fontTable}</w:fonts>`);
  if (fontRels.length)
    files["word/_rels/fontTable.xml.rels"] = enc.encode(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fontRels.join("")}</Relationships>`,
    );

  const docRels = [
    `<Relationship Id="rId1" Type="${REL}styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}settings" Target="settings.xml"/>`,
    `<Relationship Id="rId3" Type="${REL}numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rId4" Type="${REL}fontTable" Target="fontTable.xml"/>`,
    ...docPart.rels,
  ];
  files["word/_rels/document.xml.rels"] = enc.encode(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join("")}</Relationships>`,
  );
  files["_rels/.rels"] = enc.encode(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const main = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  files["[Content_Types].xml"] = enc.encode(
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
      `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${main}.settings+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="${main}.numbering+xml"/>` +
      `<Override PartName="/word/fontTable.xml" ContentType="${main}.fontTable+xml"/>` +
      overrides.join("") +
      "</Types>",
  );
  // [Content_Types].xml first, as Word writes it.
  const ordered: Record<string, Uint8Array> = { "[Content_Types].xml": files["[Content_Types].xml"] as Uint8Array };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  return zipSync(ordered, { level: 6 });
};
