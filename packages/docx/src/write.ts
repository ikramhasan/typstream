// OOXML from the document model (#131): word/document.xml and its parts, under the layout profile (#129) that makes
// Word-like engines break lines and pages where Typst did (#118's spike, spikes/docx/writers.py). Every length in the
// model is in points; OOXML wants twentieths of a point (twips), half points for text sizes and eighths of a point for
// borders. Child elements are written in the order the schema fixes: Word reports any other order as unreadable
// content, where LibreOffice and ONLYOFFICE take it.

import { zipSync } from "fflate";
import { MATH_NS, omml } from "./math";
import type {
  DocxBlock,
  DocxCell,
  DocxColumns,
  DocxDrawing,
  DocxFont,
  DocxGapRun,
  DocxList,
  DocxMathRun,
  DocxModel,
  DocxPageNumbering,
  DocxParagraph,
  DocxPictureData,
  DocxRule,
  DocxRun,
  DocxSection,
  DocxTable,
  DocxTextRun,
} from "./model";
import { drawing, PICTURE_NS, type Placement } from "./picture";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ${MATH_NS} ${PICTURE_NS} mc:Ignorable="w14"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const twips = (pt: number): number => Math.round(pt * 20);
/** Room given back in a cell, in points (see `cell`). */
const SLACK = 1;
/** Slack stays this far under a paragraph's fit: engines measure some lines a hair narrower than Typst too. */
const FIT_MARGIN = 1.0;
/** Marks where a section's properties go in the body, written once the headers' references are known. */
const SECTION = "\u0001";
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
/** Text sizes are half points: Typst's are rounded to them (edu sets them so, #130). */
const halfPoints = (pt: number): number => Math.max(2, Math.round(pt * 2));
/** Border widths are eighths of a point, from 2 to 96. */
const eighths = (pt: number): number => Math.min(96, Math.max(2, Math.round(pt * 8)));

/** A section's properties: how it starts (the first's doesn't matter), its numbering, its columns. */
interface SectionProps {
  type?: "continuous" | "nextPage";
  numbering?: DocxPageNumbering;
  cols: number;
  gap: number;
}

/** What a part being written refers to: hyperlinks and pictures' media need relationships of their own. */
interface Part {
  rels: string[];
  /** Pictures' relationship ids in this part, by index: PNG, SVG. */
  media?: Map<number, [string, string]>;
}

/** A paragraph mark's run properties: a point tall, so an empty paragraph's line is all its spacing makes it. */
const TINY = '<w:rPr><w:sz w:val="2"/></w:rPr>';
/**
 * The mark of a paragraph that holds room with an exact line `height` points tall (a spacer, an anchored drawing's
 * room), and its runs'. Google Docs has no exact line heights: it keeps `w:line` as a multiple of 240 of the font's
 * single line, at least 0.06 of it, which for a point-tall font held a fifth of a drawing's room, and the text after
 * an anchored picture ran under it (#150). Its single line of Arial is 1.15 times the size (measured), so 10.5 pt
 * Arial (12.07 pt) makes the multiple the height, 0.6% over; under 0.72 pt the multiple is 0.06, and the size makes
 * 0.06 of its line the height (3 pt for #151's breakable rooms' 0.2 pt lines: 0.207 pt, measured). Word, LibreOffice
 * and ONLYOFFICE take the exact line whatever the font.
 */
const roomMark = (height: number): string => {
  const size = height >= 0.72 ? 21 : Math.max(1, Math.round(height / 0.0345));
  return `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
};
/** A drawing's picture run: its bottom half a point below the baseline, so the point-tall font's descent is in it. */
const LOWERED = '<w:rPr><w:position w:val="-1"/><w:sz w:val="2"/></w:rPr>';
/** Letters of complex scripts: Hebrew to Sinhala, Thai to Myanmar, Khmer (#134). */
const COMPLEX = /[\u0590-\u0dff\u0e00-\u109f\u1780-\u17ff]/;

class Writer {
  /** The face equations are set in (the document's `m:mathFont`), once one is written. */
  mathFont?: string;
  /** Pictures written so far: they number their `wp:docPr`s. */
  drawings = 0;

  constructor(
    private readonly model: DocxModel,
    private readonly fonts: readonly DocxFont[],
    private readonly pictureData: readonly DocxPictureData[],
  ) {}

  /** A picture's `w:drawing`, or nothing when the model has no picture data for it. */
  private picture(index: number, part: Part, at: Placement): string {
    const p = this.model.pictures?.[index];
    if (!p || !this.pictureData[index]) return "";
    part.media ??= new Map();
    let ids = part.media.get(index);
    if (!ids) {
      ids = [`rIdPic${index + 1}p`, `rIdPic${index + 1}s`];
      part.rels.push(
        `<Relationship Id="${ids[0]}" Type="${REL}image" Target="media/picture${index + 1}.png"/>`,
        `<Relationship Id="${ids[1]}" Type="${REL}image" Target="media/picture${index + 1}.svg"/>`,
      );
      part.media.set(index, ids);
    }
    return drawing(p, ++this.drawings, ids[0], ids[1], at);
  }

  private rPr(
    font: number,
    size: number,
    color?: string,
    underline?: boolean,
    spacing?: number,
    run?: Pick<DocxTextRun, "script" | "rtl" | "lang" | "underlineColor" | "fill" | "strike"> & { raise?: number },
  ): string {
    const f = this.fonts[font];
    const name = esc(f?.name ?? "Libertinus Serif");
    let x = `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}" w:eastAsia="${name}"/>`;
    if (f?.bold) x += "<w:b/><w:bCs/>";
    if (f?.italic) x += "<w:i/><w:iCs/>";
    if (run?.strike) x += "<w:strike/>";
    if (color) x += `<w:color w:val="${color}"/>`;
    if (spacing) x += `<w:spacing w:val="${spacing}"/>`;
    if (run?.raise) x += `<w:position w:val="${Math.round(run.raise * 2)}"/>`;
    const sz = halfPoints(size);
    x += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
    if (underline) x += `<w:u w:val="single"${run?.underlineColor ? ` w:color="${run.underlineColor}"` : ""}/>`;
    if (run?.fill) x += `<w:shd w:val="clear" w:color="auto" w:fill="${run.fill}"/>`;
    if (run?.script) x += `<w:vertAlign w:val="${run.script}"/>`;
    if (run?.rtl) x += "<w:rtl/>";
    if (run?.lang) x += `<w:lang w:val="${run.lang}" w:eastAsia="${run.lang}" w:bidi="${run.lang}"/>`;
    return `<w:rPr>${x}</w:rPr>`;
  }

  private run(r: DocxRun, part: Part, jc = "center", rtl = false, complex = false): string {
    if ("break" in r) return "<w:r><w:br/></w:r>";
    if ("math" in r) {
      this.mathFont ??= this.fonts[r.font]?.name;
      const math = `<m:oMath>${omml(r.math, this.rPr(r.font, r.size, r.color))}</m:oMath>`;
      // A display equation: Word sets it on a line of its own, aligned as the paragraph.
      if (r.display) return `<m:oMathPara><m:oMathParaPr><m:jc m:val="${jc}"/></m:oMathParaPr>${math}</m:oMathPara>`;
      return math;
    }
    if ("tab" in r) return "<w:r><w:tab/></w:r>";
    if ("gap" in r) {
      // A picture in the line: a character as wide as its room, its bottom on the baseline unless raised (half points).
      // Lowered, it is anchored to its line, in front of a gap as wide.
      if (r.picture?.line !== undefined)
        return `<w:r>${TINY}${this.picture(r.picture.index, part, { kind: "line", x: 0, y: r.picture.line })}</w:r>${this.run({ ...r, picture: undefined }, part, jc, rtl, complex)}`;
      const picture = r.picture && this.picture(r.picture.index, part, { kind: "inline" });
      if (r.picture && picture) {
        const height = this.model.pictures?.[r.picture.index]?.height ?? 0;
        const raise = Math.round(-(r.picture.y + height) * 2);
        const sz = halfPoints(r.size);
        return `<w:r><w:rPr><w:position w:val="${raise}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>${picture}</w:r>`;
      }
      // A no-break space, widened to the gap by character spacing: exact to a twip, and Word underlines the spacing too.
      const nbsp = (this.fonts[r.font]?.nbsp ?? 0.25) * halfPoints(r.size) * 10;
      // U+00A0, written as a character reference so it stays visible in the source. In a right-to-left paragraph, a
      // right-to-left run: engines place runs by their direction.
      const space = (n: number, spacing: number) =>
        `<w:r>${this.rPr(r.font, r.size, undefined, r.underline, spacing, { ...r, rtl })}<w:t xml:space="preserve">${"&#160;".repeat(n)}</w:t></w:r>`;
      if (!complex) return space(1, Math.max(0, twips(r.gap) - Math.round(nbsp)));
      // Among complex-script text (Arabic, Indic), as many no-break spaces as fill the gap, the last spaced by the
      // rest: ONLYOFFICE ignores character spacing there (#134), so it is off by half a space at most.
      const count = Math.max(1, Math.round(twips(r.gap) / Math.max(1, nbsp)));
      const rest = Math.round(twips(r.gap) - count * nbsp);
      return (count > 1 ? space(count - 1, 0) : "") + space(1, rest);
    }
    const run = `<w:r>${this.rPr(r.font, r.size, r.color, r.underline, undefined, r)}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
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
    tabs?: DocxParagraph["tabs"];
    bidi?: boolean;
    before?: number;
    after?: number;
    line: number;
    atLeast?: boolean;
    /** Single spacing (`auto`): the line as tall as what is in it, `line` ignored. */
    single?: boolean;
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
      x += `<w:tabs>${o.tabs.map((t) => `<w:tab w:val="${t.align === "end" ? "right" : t.align === "center" ? "center" : "left"}"${t.leader ? ` w:leader="${t.leader}"` : ""} w:pos="${twips(t.pos)}"/>`).join("")}</w:tabs>`;
    // Right to left: `left` and `right` (alignment, indents, tabs) are the paragraph's start and end.
    if (o.bidi) x += "<w:bidi/>";
    const line = o.single
      ? 'w:line="240" w:lineRule="auto"'
      : `w:line="${Math.max(1, twips(o.line))}" w:lineRule="${o.atLeast ? "atLeast" : "exact"}"`;
    x += `<w:spacing w:before="${Math.max(0, twips(o.before ?? 0))}" w:after="${Math.max(0, twips(o.after ?? 0))}" ${line}/>`;
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

  /** A paragraph; `lead` goes before its runs (pictures anchored in it). */
  paragraph(p: DocxParagraph, part: Part, after?: number, lead = ""): string {
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
    let runs = p.runs;
    // An inline equation alone in its paragraph (a table cell's) is a display one to Word-like engines, its fractions
    // full size: a zero-width space beside it keeps it in the line, as Typst set it.
    const math = runs.find((r) => "math" in r && !r.display) as DocxMathRun | undefined;
    if (math && runs.every((r) => "math" in r || "tab" in r || "break" in r))
      runs = [...runs, { text: "\u200b", font: math.font, size: math.size }];
    // A blank ending the paragraph: engines don't underline trailing spaces, no-break ones included. A word joiner
    // after it makes them inner ones (#135).
    const last = runs.at(-1);
    if (last && "gap" in last && last.underline && !last.picture)
      runs = [...runs, { text: "\u2060", font: last.font, size: last.size }];
    const complex = runs.some((r) => "text" in r && COMPLEX.test(r.text));
    const content =
      lead + label + runs.map((r) => this.run(r, part, jc === "left" ? "left" : jc, p.rtl, complex)).join("");
    return `<w:p>${this.pPr({
      style: p.heading ? `Heading${Math.min(6, p.heading)}` : undefined,
      keepNext: p.heading !== undefined,
      pageBreak: p.pageBreak,
      frame: p.frame,
      num,
      tabs: p.tabs,
      bidi: p.rtl,
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

  /** A paragraph holding space: exact height, with nothing in it but `content` (anchored pictures). */
  spacer(height: number, before = 0, pageBreak = false, left = 0, content = ""): string {
    const line = Math.max(0.05, height);
    return `<w:p>${this.pPr({ pageBreak, before, line, left, rPr: roomMark(line) })}${content}</w:p>`;
  }

  /**
   * A rule: an empty paragraph exactly as tall as the stroke, shaded in its colour. Engines size a paragraph's border
   * differently (LibreOffice draws a bottom border within an exact line, ONLYOFFICE adds it below), its shading not.
   */
  rule(r: DocxRule): string {
    return `<w:p>${this.pPr({
      pageBreak: r.pageBreak,
      border: `<w:shd w:val="clear" w:color="auto" w:fill="${r.color}"/>`,
      before: r.before,
      line: r.thickness,
      left: r.indent.left,
      right: r.indent.right,
      rPr: '<w:rPr><w:sz w:val="2"/></w:rPr>',
    })}</w:p>`;
  }

  /**
   * A drawing: its picture as a character in a line of its own, single spaced, so the line is as tall as the picture
   * in every engine, the space before and after it holding the rest of its room. Not anchored over an exact line, as
   * far as it can be: Google Docs has no exact line heights (it makes them multiples of the paragraph's point-tall
   * font), so the line would hold a fraction of the room and the text after it would run under the picture.
   */
  drawing(d: DocxDrawing, part: Part, lead = "", width?: number): string {
    const p = d.picture && this.model.pictures?.[d.picture.index];
    if (!d.picture || !p) return this.anchored(d, part, lead);
    const { x, y } = d.picture;
    // A picture past the room's bottom (half a stroke) takes that from the space above it: the picture a hair higher,
    // the text after it where Typst put it.
    const below = d.height - y - p.height;
    const before = (d.before ?? 0) + y + Math.min(0, below);
    // Anchored where a character couldn't be where Typst drew it: starting left of its container or reaching past a
    // cell's right margin (a box as wide as a cell, its stroke half outside: engines clip a character at a cell's
    // edges), or past its room by more than the space above it (the line would be taller than the room, and the
    // text after it lower). In the body, what reaches into the right margin is drawn.
    const clipped = d.indent + x < 0 || (width !== undefined && d.indent + x + p.width > width + 0.01);
    if (clipped || before < -0.01) return this.anchored(d, part, lead);
    const picture = this.picture(d.picture.index, part, { kind: "inline" });
    // No picture data: the room alone.
    if (!picture) return this.anchored(d, part, lead);
    return `<w:p>${this.pPr({
      pageBreak: d.pageBreak,
      before,
      after: below,
      line: 0,
      single: true,
      left: d.indent + x,
      rPr: TINY,
    })}${lead}<w:r>${LOWERED}${picture}</w:r></w:p>`;
  }

  /** A drawing as a paragraph holding its room, its picture anchored where the room starts. */
  private anchored(d: DocxDrawing, part: Part, lead: string): string {
    const picture = d.picture && this.picture(d.picture.index, part, { kind: "line", x: d.picture.x, y: d.picture.y });
    // Breakable: lines a fifth of a point tall, which engines break between pages.
    const line = d.breakable ? 0.2 : d.height;
    return this.spacer(
      line,
      d.before,
      d.pageBreak,
      d.indent,
      lead +
        (picture ? `<w:r>${roomMark(line)}${picture}</w:r>` : "") +
        (d.breakable ? `<w:r>${roomMark(line)}${"<w:br/>".repeat(d.height * 5 - 1)}</w:r>` : ""),
    );
  }

  /** A placed drawing's picture, anchored to the page where Typst drew it: a run for a paragraph to hold. */
  placed(d: DocxDrawing, part: Part): string {
    const p = d.picture && this.model.pictures?.[d.picture.index];
    const picture = d.picture && p && this.picture(d.picture.index, part, { kind: "page", x: p.x, y: p.y });
    return picture ? `<w:r>${TINY}${picture}</w:r>` : "";
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
        return b
          ? `<w:${s} w:val="${b.style ?? "single"}" w:sz="${eighths(b.width)}" w:space="0" w:color="${b.color}"/>`
          : "";
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
    // No more than the cell's paragraphs' fit, or an engine would set a word Typst moved down on the line before.
    const fit = c.blocks.reduce(
      (f, b) => (b.type === "p" && b.fit !== undefined ? Math.min(f, b.fit - FIT_MARGIN) : f),
      SLACK,
    );
    const right = Math.max(0, m.right - Math.max(0, fit));
    pr +=
      `<w:tcMar><w:top w:w="${twips(m.top)}" w:type="dxa"/><w:left w:w="${twips(m.left)}" w:type="dxa"/>` +
      `<w:bottom w:w="${twips(m.bottom)}" w:type="dxa"/><w:right w:w="${twips(right)}" w:type="dxa"/></w:tcMar>`;
    if (c.valign) pr += `<w:vAlign w:val="${c.valign}"/>`;
    // What the cell's paragraphs have between its margins, in points: a drawing's picture past it is anchored.
    let body = this.blocks(c.blocks, part, width / 20 - m.left - right);
    // A cell ends with a paragraph; after a table, one that takes no room. LibreOffice drops a cell's last paragraph
    // when it is empty and follows a table, as the paragraph Word requires there: a rule (an answer line under a
    // callout in a question) or a room would go, and the space it holds. One that takes no room after it instead.
    const [prev, last] = c.blocks.slice(-2);
    const empty = last?.type === "rule" || (last?.type === "drawing" && !last.placed && !last.picture);
    if (!body.endsWith("</w:p>") || (prev?.type === "table" && empty)) body += this.spacer(0.05);
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${body}</w:tc>`;
  }

  /**
   * Blocks in order, in a cell `width` points wide between its margins (none in the body). A table has no space
   * before: the paragraph before it gets it after, or a spacer holds it.
   */
  blocks(blocks: readonly DocxBlock[], part: Part, width?: number): string {
    const out: string[] = [];
    // Placed pictures waiting for the next paragraph or drawing to hold them.
    let lead = "";
    blocks.forEach((b, i) => {
      if (b.type === "drawing" && b.placed) {
        const run = this.placed(b, part);
        const last = out.length - 1;
        // In the paragraph before it, when the one after is on a later page.
        if (b.host === "previous" && last >= 0 && (out[last] as string).endsWith("</w:p>"))
          out[last] = `${(out[last] as string).slice(0, -"</w:p>".length)}${run}</w:p>`;
        else lead += run;
        return;
      }
      // Typst's page numbering changes here: a section on a new page, numbered from there. The section before ends
      // in its last paragraph (an empty one of its own could take a line on a full page, and a page with it).
      if (b.pageNumbering) {
        const marker = this.endSection({ type: "nextPage", numbering: b.pageNumbering, cols: 1, gap: 0 });
        const last = out.length - 1;
        if (last >= 0 && (out[last] as string).endsWith("</w:pPr></w:p>"))
          out[last] = (out[last] as string).replace(/<\/w:pPr><\/w:p>$/, `${marker}</w:pPr></w:p>`);
        else if (last >= 0 && (out[last] as string).endsWith("</w:p>")) {
          const p = out[last] as string;
          const at = p.lastIndexOf("</w:pPr>");
          out[last] = `${p.slice(0, at)}${marker}${p.slice(at)}`;
        } else out.push(`<w:p>${this.pPr({ line: 0.05, rPr: `<w:rPr><w:sz w:val="2"/></w:rPr>${marker}` })}</w:p>`);
      }
      const next = blocks[i + 1];
      const gapAfter = next?.type === "table" && b.type === "p" ? (next.before ?? 0) : undefined;
      // Anything else holds waiting pictures in a paragraph of its own, as small as a paragraph gets.
      if (lead && b.type !== "p" && b.type !== "drawing") {
        out.push(this.spacer(0.05, 0, false, 0, lead));
        lead = "";
      }
      switch (b.type) {
        case "p":
          out.push(this.paragraph(b, part, gapAfter, lead));
          lead = "";
          break;
        case "table": {
          const prev = blocks[i - 1];
          // Two tables in a row would merge into one: a paragraph between them, as tall as the gap.
          if (prev && prev.type !== "p") out.push(this.spacer(Math.max(0.05, b.before ?? 0)));
          else if (!prev && (b.before ?? 0) > 0.05) out.push(this.spacer(b.before ?? 0));
          if (b.pageBreak) out.push(this.spacer(0.05, 0, true));
          // Word breaks a page before a paragraph, not a row: a row that starts a page splits the table there.
          const headers = b.rows.filter((r) => r.header);
          let from = 0;
          b.rows.forEach((row, k) => {
            if (!row.pageBreak || k === 0) return;
            out.push(this.table({ ...b, rows: [...(from > 0 ? headers : []), ...b.rows.slice(from, k)] }, part));
            out.push(this.spacer(0.05, 0, true));
            from = k;
          });
          out.push(this.table({ ...b, rows: [...(from > 0 ? headers : []), ...b.rows.slice(from)] }, part));
          break;
        }
        case "rule": {
          // Rules one after another (answer lines): LibreOffice shades paragraphs with the same shading as one block,
          // the gap between them too. A paragraph a hundredth of a point tall between them keeps them apart.
          const prev = blocks[i - 1];
          if (prev?.type === "rule" && !b.pageBreak) {
            out.push(this.spacer(0.05, Math.max(0, (b.before ?? 0) - 0.05)));
            out.push(this.rule({ ...b, before: 0 }));
          } else out.push(this.rule(b));
          break;
        }
        case "drawing":
          out.push(this.drawing(b, part, lead, width));
          lead = "";
          break;
        case "columns":
          out.push(this.columns(b, part));
          break;
      }
    });
    if (lead) out.push(this.spacer(0.05, 0, false, 0, lead));
    return out.join("");
  }

  /**
   * The section being written, and those ended so far (their properties go at their ends, as OOXML has them): how
   * each starts (on the same page, a column section; on a new one, a page numbering's), its columns and numbering.
   */
  current: SectionProps = { cols: 1, gap: 0 };
  ended: SectionProps[] = [];

  /** Ends the section being written, `next` starting after it: a marker where its properties go. */
  endSection(next: SectionProps): string {
    this.ended.push(this.current);
    this.current = next;
    return `${SECTION}${this.ended.length - 1}${SECTION}`;
  }

  /**
   * Columns as Word has them, in a section: a section break before (the text so far, one column), a column break
   * between columns, and a section break with the columns after. Breaks are paragraphs a hundredth of a point tall.
   * The section properties need the headers' references, written after the body: they stand in as markers here.
   */
  columns(c: DocxColumns, part: Part): string {
    const tiny = '<w:rPr><w:sz w:val="2"/></w:rPr>';
    const brk = `<w:p>${this.pPr({ line: 0.05, rPr: tiny })}<w:r>${tiny}<w:br w:type="column"/></w:r></w:p>`;
    const start = this.endSection({ type: "continuous", cols: c.columns.length, gap: c.gap });
    // The space before goes on the first column's first block: an engine may drop an empty paragraph that ends a
    // section, its spacing with it.
    const [first = [], ...rest] = c.columns;
    const lead = first.map((b, i) => (i === 0 ? { ...b, before: (b.before ?? 0) + (c.before ?? 0) } : b));
    const columns = [lead, ...rest].map((col) => this.blocks(col, part)).join(brk);
    const end = this.endSection({ type: "continuous", cols: 1, gap: 0 });
    return (
      `<w:p>${this.pPr({ pageBreak: c.pageBreak, line: 0.05, rPr: `${tiny}${start}` })}</w:p>` +
      columns +
      `<w:p>${this.pPr({ line: 0.05, rPr: `${tiny}${end}` })}</w:p>`
    );
  }

  /** A section's properties, in CT_SectPr's order; only the document's first section has a first page of its own. */
  section(s: DocxSection, refs: string, p: SectionProps, first: boolean): string {
    const landscape = s.width > s.height ? ' w:orient="landscape"' : "";
    const m = s.margin;
    const n = p.numbering;
    return (
      `<w:sectPr>${refs}${!first && p.type ? `<w:type w:val="${p.type}"/>` : ""}` +
      `<w:pgSz w:w="${twips(s.width)}" w:h="${twips(s.height)}"${landscape}/>` +
      `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" ` +
      `w:header="${twips(s.headerDistance ?? m.top / 2)}" w:footer="${twips(s.footerDistance ?? m.bottom / 2)}" w:gutter="0"/>` +
      (n ? `<w:pgNumType w:fmt="${n.format}"${n.start === undefined ? "" : ` w:start="${n.start}"`}/>` : "") +
      (p.cols > 1 ? `<w:cols w:num="${p.cols}" w:space="${twips(p.gap)}"/>` : "") +
      (first && (s.headerFirst || s.footerFirst) ? "<w:titlePg/>" : "") +
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
export const writeDocx = (
  model: DocxModel,
  fonts: readonly Uint8Array[],
  pictures: readonly DocxPictureData[] = [],
): Uint8Array => {
  const w = new Writer(model, model.fonts, pictures);
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  const section = model.sections[0];
  if (!section) throw new Error("docx: a document model has at least one section");
  const docPart: Part = { rels: [] };
  w.current = { cols: 1, gap: 0, numbering: section.pageNumbering };
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

  const sections = body.replace(new RegExp(`${SECTION}(\\d+)${SECTION}`, "g"), (_, k: string) =>
    w.section(section, refs, w.ended[Number(k)] as SectionProps, k === "0"),
  );
  files["word/document.xml"] = enc.encode(
    `${XML}<w:document ${NS}><w:body>${sections}${w.section(section, refs, w.current, w.ended.length === 0)}</w:body></w:document>`,
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
      // No punctuation hanging past the margin (East Asian lines' commas, #134): Typst breaks before it.
      '<w:pPrDefault><w:pPr><w:widowControl/><w:overflowPunct w:val="0"/>' +
      '<w:spacing w:before="0" w:after="0" w:line="286" w:lineRule="exact"/></w:pPr></w:pPrDefault>' +
      "</w:docDefaults>" +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      headings +
      "</w:styles>",
  );

  // Numbering: one abstract numbering and one instance per list. Its label in the face, size and colour Typst set it
  // in: Word sets a number as its paragraph's mark otherwise, the first run's (a bold "T." made the numbers bold).
  const label = (l: DocxList): string => {
    const f = l.labelFont === undefined ? undefined : model.fonts[l.labelFont];
    const name = f ? esc(f.name) : base;
    const sz =
      l.labelSize === undefined
        ? ""
        : `<w:sz w:val="${halfPoints(l.labelSize)}"/><w:szCs w:val="${halfPoints(l.labelSize)}"/>`;
    return (
      `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}"/>` +
      (f
        ? `<w:b w:val="${f.bold ? 1 : 0}"/><w:bCs w:val="${f.bold ? 1 : 0}"/><w:i w:val="${f.italic ? 1 : 0}"/><w:iCs w:val="${f.italic ? 1 : 0}"/>`
        : "") +
      (l.labelColor ? `<w:color w:val="${l.labelColor}"/>` : f ? '<w:color w:val="000000"/>' : "") +
      sz
    );
  };
  const abstract = model.lists
    .map((l, i) => {
      const hanging = Math.max(0, l.bodyLeft - (l.align === "end" ? l.labelRight : l.labelLeft));
      return (
        `<w:abstractNum w:abstractNumId="${i}"><w:multiLevelType w:val="singleLevel"/>` +
        `<w:lvl w:ilvl="0"><w:start w:val="${l.start}"/><w:numFmt w:val="${l.format === "none" ? "decimal" : l.format}"/>` +
        `<w:lvlText w:val="${esc(l.text)}"/><w:lvlJc w:val="${l.align === "end" ? "right" : "left"}"/>` +
        `<w:pPr><w:ind w:left="${twips(l.bodyLeft)}" w:hanging="${twips(hanging)}"/></w:pPr>` +
        `<w:rPr>${label(l)}</w:rPr></w:lvl></w:abstractNum>`
      );
    })
    .join("");
  const nums = model.lists.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i}"/></w:num>`).join("");
  files["word/numbering.xml"] = enc.encode(`${XML}<w:numbering ${NS}>${abstract}${nums}</w:numbering>`);

  files["word/settings.xml"] = enc.encode(
    `${XML}<w:settings ${NS}><w:embedTrueTypeFonts/><w:defaultTabStop w:val="720"/>` +
      '<w:autoHyphenation w:val="false"/><w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      // Equations are in Typst's math font (Word accepts only fonts with a MATH table as one).
      (w.mathFont ? `<m:mathPr><m:mathFont m:val="${esc(w.mathFont)}"/></m:mathPr>` : "") +
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

  // Pictures' media, which the parts' relationships name.
  pictures.forEach((p, i) => {
    files[`word/media/picture${i + 1}.png`] = p.png;
    files[`word/media/picture${i + 1}.svg`] = enc.encode(p.svg);
  });

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
      (pictures.length
        ? '<Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>'
        : "") +
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
