// Pictures (#133) as DrawingML (ECMA-376 Part 1 §20.4): what Typst drew of something the model can't express
// otherwise, as SVG with a PNG fallback. The SVG goes in Word's `asvg:svgBlip` extension, which Word 2016 and later,
// LibreOffice and ONLYOFFICE draw; the PNG is the `a:blip` itself, for older Word and apps that don't read the
// extension. Lengths are EMUs (12,700 to a point).

import type { DocxPicture } from "./model";

export const PICTURE_NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const SVG_EXT = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";
const SVG_NS = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

const emu = (pt: number): number => Math.round(pt * 12700);
const esc = (s: string): string =>
  s.replace(
    /[&<>"\n]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\n": "&#10;" })[c] as string,
  );

/** Where a picture goes: in the line as a character, or anchored to its line or the page. */
export type Placement =
  | { kind: "inline" }
  | { kind: "line"; x: number; y: number }
  | { kind: "page"; x: number; y: number };

/**
 * A picture's `w:drawing`: `id` numbers it in the document (`wp:docPr`), `png` and `svg` are the relationship ids of
 * its media in the part it is written into.
 */
export function drawing(p: DocxPicture, id: number, png: string, svg: string, at: Placement): string {
  const extent = `<wp:extent cx="${emu(p.width)}" cy="${emu(p.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`;
  // Its description is what screen readers read in Word.
  const doc = `<wp:docPr id="${id}" name="Picture ${id}"${p.alt ? ` descr="${esc(p.alt)}"` : ""}/>`;
  const graphic =
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${png}"><a:extLst><a:ext uri="${SVG_EXT}">` +
    `<asvg:svgBlip xmlns:asvg="${SVG_NS}" r:embed="${svg}"/></a:ext></a:extLst></a:blip>` +
    "<a:stretch><a:fillRect/></a:stretch></pic:blipFill>" +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(p.width)}" cy="${emu(p.height)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
  if (at.kind === "inline")
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">${extent}${doc}<wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing>`;
  // Anchored: in front of the text, which flows as if it weren't there (its room is held by the paragraph). From
  // its anchor's character and line, which are where the room starts; or from the page's corner.
  const [h, v] = at.kind === "line" ? ["character", "line"] : ["page", "page"];
  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" ` +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${h}"><wp:posOffset>${emu(at.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${v}"><wp:posOffset>${emu(at.y)}</wp:posOffset></wp:positionV>` +
    `${extent}<wp:wrapNone/>${doc}<wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing>`
  );
}
