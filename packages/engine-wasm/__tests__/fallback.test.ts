// Font fallback for text with no font set (#80), with the worker's fonts: the
// base set, and the rest of Typst's bundled faces (#128) and the script fonts
// registered lazily, nothing else. Typst picks the face that covers
// a run's first character and is most like the current font. New Computer
// Modern Math covers Devanagari and, like Libertinus Serif, isn't flagged
// serif, so native typst sets Devanagari in the math font; engine-wasm's font
// book keeps math faces out of fallback for other scripts' letters (fonts.rs).
// Everything else must stay byte-identical to native typst with the same files.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { baseFonts, extraFonts, scriptFonts } from "../dist/fonts.js";
import { Engine } from "./support/engine.js";
import { nativePdf, nativeSvgPages } from "./support/native.js";

const fontDir = dirname(fileURLToPath(new URL("../dist/fonts/LICENSE-Noto.txt", import.meta.url)));
const only = { only: true };

/** The faces a PDF embeds, by PostScript name without the subset tag. */
const faces = (pdf: Uint8Array): string[] => {
  const names = Buffer.from(pdf)
    .toString("latin1")
    .matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([\w-]+)/g);
  return [...new Set([...names].map((m) => m[1] ?? "").filter((name) => !name.endsWith("-Identity-H")))].sort();
};

const engine = (): InstanceType<typeof Engine> => new Engine();
const pdf = (source: string): Uint8Array => {
  const e = engine();
  e.set_source("/main.typ", source);
  const result = e.compile_pdf();
  e.free();
  expect(result.diagnostics).toEqual([]);
  return result.pdf as Uint8Array;
};
const svg = (source: string): string[] | undefined => {
  const e = engine();
  e.set_source("/main.typ", source);
  const pages = e.compile_svg_changed().changed?.map((page) => page.svg);
  e.free();
  return pages;
};

const DEVANAGARI = "प्रकाश संश्लेषण";
const BENGALI = "আলোকসংশ্লেষণ";
const ARABIC = "التمثيل الضوئي";

/** Registered lazy font ids by file name. */
const ids = new Map<string, number>();

beforeAll(() => {
  for (const url of baseFonts) Engine.add_font(readFileSync(url));
  for (const font of [...extraFonts, ...scriptFonts]) ids.set(font.file, Engine.register_font(font.info));
});

describe("fallback for unnamed text", () => {
  it("asks for the bundled faces the base set lacks, as native typst would pick them", () => {
    const e = engine();
    for (const [source, file] of [
      // Symbols Libertinus Serif lacks: text fallback picks the math font's regular face.
      ["sets ∀x ∈ ℝ, ℏ and 𝔸 in text", "NewCMMath-Regular.ttf"],
      ["*_bold italic_*", "LibertinusSerif-BoldItalic.ttf"],
      ["*`bold raw`*", "DejaVuSansMono-Bold.ttf"],
      ["*bold $x^2$*", "NewCMMath-Bold.ttf"],
    ] as const) {
      e.set_source("/main.typ", source);
      // Among others: while a face has no bytes, Typst tries the next one and asks for it too.
      expect(e.compile_svg_changed().missingFonts, source).toContain(ids.get(file));
    }
    e.free();
    // Then load them all, as the worker does once a compile asks.
    for (const font of extraFonts) Engine.load_font(ids.get(font.file) ?? -1, readFileSync(font.url));
  });

  it("asks for Noto Serif Devanagari, not the math font", () => {
    const e = engine();
    for (const [source, file] of [
      [DEVANAGARI, "NotoSerifDevanagari-Regular.ttf"],
      [`*${DEVANAGARI}*`, "NotoSerifDevanagari-Bold.ttf"],
      // Raw text: fallback from DejaVu Sans Mono.
      [`\`${DEVANAGARI}\``, "NotoSerifDevanagari-Regular.ttf"],
    ] as const) {
      e.set_source("/main.typ", source);
      expect(e.compile_svg_changed().missingFonts, source).toEqual([ids.get(file)]);
    }
    // HTML lays out only frames; the browser draws the rest.
    e.set_source("/main.typ", `${DEVANAGARI} #html.frame[${DEVANAGARI}]`);
    expect(e.compile_html().missingFonts).toEqual([ids.get("NotoSerifDevanagari-Regular.ttf")]);
    e.free();
    // Then load them all, as the worker does once a compile asks.
    for (const font of scriptFonts) Engine.load_font(ids.get(font.file) ?? -1, readFileSync(font.url));
  });

  it.each([
    ["Devanagari", DEVANAGARI, ["LibertinusSerif-Regular", "NotoSerifDevanagari-Regular"]],
    ["bold Devanagari", `*${DEVANAGARI}*`, ["LibertinusSerif-Bold", "NotoSerifDevanagari-Bold"]],
    ["raw Devanagari", `\`${DEVANAGARI}\``, ["DejaVuSansMono", "NotoSerifDevanagari-Regular"]],
    ["Bengali", BENGALI, ["NotoSerifBengali-Regular"]],
    ["Arabic", ARABIC, ["LibertinusSerif-Regular", "NotoNaskhArabic-Regular"]],
    [
      "Bengali and Arabic, bold",
      `*${BENGALI} ${ARABIC}*`,
      ["LibertinusSerif-Bold", "NotoNaskhArabic-Bold", "NotoSerifBengali-Bold"],
    ],
  ])("sets %s in its Noto face", (_name, source, expected) => {
    expect(faces(pdf(source))).toEqual(expected);
  });

  it("differs from native typst only for Devanagari", () => {
    // Native typst with the same files: the math font, without the script's shaping.
    for (const source of [DEVANAGARI, `*${DEVANAGARI}*`, `\`${DEVANAGARI}\``]) {
      const native = faces(nativePdf(source, [fontDir], only));
      // Regular, or Bold for bold text: native picks the math face nearest the text's weight.
      expect(
        native.some((face) => face.startsWith("NewCMMath-")),
        source,
      ).toBe(true);
      expect(
        native.some((face) => face.startsWith("NotoSerifDevanagari")),
        source,
      ).toBe(false);
    }
    for (const source of [BENGALI, ARABIC, `*${BENGALI} ${ARABIC}*`]) {
      expect(faces(pdf(source)), source).toEqual(faces(nativePdf(source, [fontDir], only)));
      expect(svg(source), source).toEqual(nativeSvgPages(source, [fontDir], only));
    }
  });

  it("leaves math and symbols as native typst draws them", () => {
    const source = `= Symbols and math
Arrows → ⇒, sets ∀x ∈ ℝ, ℏ and 𝔸 in text.
$ integral_0^1 x^2 dif x = 1/3, quad sum_(k=1)^n k = (n(n+1))/2, quad vec(a, b) $
$ upright(bold(A)) times cal(B), alpha beta gamma, sqrt(2) approx 1.414 $
Inline $f(x) = sin(x)$ and \${x in NN | x > 2}$.`;
    expect(svg(source)).toEqual(nativeSvgPages(source, [fontDir], only));
  });
});
