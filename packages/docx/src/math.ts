// Word math (OMML, ECMA-376 Part 1 §22.1) from an equation's tree (#132). Properties come first in each element
// (`m:fPr`, `m:naryPr`, …) and arguments follow in the schema's order; a run's math properties (`m:rPr`) come before
// its text properties (`w:rPr`).

import type { DocxMath } from "./model";

export const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const val = (name: string, v: string | number): string => `<m:${name} m:val="${esc(String(v))}"/>`;
const arg = (name: string, nodes: DocxMath[] | undefined, rPr: string): string =>
  `<m:${name}>${omml(nodes ?? [], rPr)}</m:${name}>`;

/** An equation's pieces as OMML; `rPr` is the text properties every run gets (the math font, size, colour). */
export function omml(nodes: DocxMath[], rPr: string): string {
  let x = "";
  for (const n of nodes) x += node(n, rPr);
  return x;
}

function node(n: DocxMath, rPr: string): string {
  switch (n.t) {
    case "r": {
      // CT_RPR: normal text, or an alphabet then a style.
      const props = n.nor ? "<m:nor/>" : (n.scr ? val("scr", n.scr) : "") + (n.sty ? val("sty", n.sty) : "");
      const mrPr = props ? `<m:rPr>${props}</m:rPr>` : "";
      return `<m:r>${mrPr}${rPr}<m:t xml:space="preserve">${esc(n.text)}</m:t></m:r>`;
    }
    case "f":
      return (
        `<m:f>${n.type ? `<m:fPr>${val("type", n.type)}</m:fPr>` : ""}` +
        `${arg("num", n.num, rPr)}${arg("den", n.den, rPr)}</m:f>`
      );
    case "s": {
      const e = arg("e", n.e, rPr);
      if (n.pre) return `<m:sPre>${arg("sub", n.sub, rPr)}${arg("sup", n.sup, rPr)}${e}</m:sPre>`;
      if (n.sub && n.sup) return `<m:sSubSup>${e}${arg("sub", n.sub, rPr)}${arg("sup", n.sup, rPr)}</m:sSubSup>`;
      if (n.sub) return `<m:sSub>${e}${arg("sub", n.sub, rPr)}</m:sSub>`;
      return `<m:sSup>${e}${arg("sup", n.sup, rPr)}</m:sSup>`;
    }
    case "nary": {
      // CT_NaryPr: chr, limLoc, grow, subHide, supHide.
      const pr =
        val("chr", n.chr) +
        val("limLoc", n.limits ? "undOvr" : "subSup") +
        (n.sub ? "" : val("subHide", 1)) +
        (n.sup ? "" : val("supHide", 1));
      return `<m:nary><m:naryPr>${pr}</m:naryPr>${arg("sub", n.sub, rPr)}${arg("sup", n.sup, rPr)}${arg("e", n.e, rPr)}</m:nary>`;
    }
    case "func":
      return `<m:func>${arg("fName", n.name, rPr)}${arg("e", n.e, rPr)}</m:func>`;
    case "lim": {
      const tag = n.below ? "limLow" : "limUpp";
      return `<m:${tag}>${arg("e", n.e, rPr)}${arg("lim", n.lim, rPr)}</m:${tag}>`;
    }
    case "rad":
      // The degree is always there, hidden for a square root.
      return `<m:rad>${n.deg ? "" : `<m:radPr>${val("degHide", 1)}</m:radPr>`}${arg("deg", n.deg, rPr)}${arg("e", n.e, rPr)}</m:rad>`;
    case "d":
      // CT_DPr: begChr, sepChr, endChr.
      return `<m:d><m:dPr>${val("begChr", n.open)}${val("endChr", n.close)}</m:dPr>${arg("e", n.e, rPr)}</m:d>`;
    case "m": {
      // CT_MPr: rSpRule, cGpRule, rSp, cSp, cGp, mcs. Columns of the same alignment share one `m:mc`.
      let mcs = "";
      for (let i = 0; i < n.align.length; ) {
        let count = 1;
        while (n.align[i + count] === n.align[i]) count++;
        mcs += `<m:mc><m:mcPr>${val("count", count)}${val("mcJc", n.align[i] as string)}</m:mcPr></m:mc>`;
        i += count;
      }
      // An exact column gap (rule 3) is in twips.
      const gap = n.gap === undefined ? "" : val("cGpRule", 3) + val("cGp", Math.round(n.gap * 20));
      // An empty cell holds a zero-width space: LibreOffice drops empty cells, its rows then ragged.
      const cell = (c: DocxMath[]): DocxMath[] => (c.length ? c : [{ t: "r", text: "\u200b" }]);
      const rows = n.rows.map((row) => `<m:mr>${row.map((c) => arg("e", cell(c), rPr)).join("")}</m:mr>`).join("");
      return `<m:m><m:mPr>${gap}<m:mcs>${mcs}</m:mcs></m:mPr>${rows}</m:m>`;
    }
    case "acc":
      return `<m:acc><m:accPr>${val("chr", n.chr)}</m:accPr>${arg("e", n.e, rPr)}</m:acc>`;
    case "bar":
      return `<m:bar><m:barPr>${val("pos", n.top ? "top" : "bot")}</m:barPr>${arg("e", n.e, rPr)}</m:bar>`;
    case "groupChr":
      // CT_GroupChrPr: chr, pos, vertJc.
      return (
        `<m:groupChr><m:groupChrPr>${val("chr", n.chr)}${val("pos", n.top ? "top" : "bot")}` +
        `${val("vertJc", n.top ? "bot" : "top")}</m:groupChrPr>${arg("e", n.e, rPr)}</m:groupChr>`
      );
    case "box": {
      // CT_BorderBoxPr: hideTop, hideBot, hideLeft, hideRight, strikeH, strikeV, strikeBLTR, strikeTLBR.
      const hide = val("hideTop", 1) + val("hideBot", 1) + val("hideLeft", 1) + val("hideRight", 1);
      const strike =
        (n.strike !== "tlbr" ? val("strikeBLTR", 1) : "") + (n.strike !== "bltr" ? val("strikeTLBR", 1) : "");
      return `<m:borderBox><m:borderBoxPr>${hide}${strike}</m:borderBoxPr>${arg("e", n.e, rPr)}</m:borderBox>`;
    }
  }
}
