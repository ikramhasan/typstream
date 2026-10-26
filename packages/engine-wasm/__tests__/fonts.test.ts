// Lazy fonts (#11, PLAN §6.4): faces registered from their FontInfo are in the
// font book before their bytes are. A compile that selects one reports it in
// `missingFonts` and falls back; once loaded, output matches native typst with
// the same files on its font path.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type ScriptFont, scriptFonts } from "../dist/fonts.js";
import { Engine, newEngine } from "./support/engine.js";
import { nativeSvgPages } from "./support/native.js";

const bytes = (url: URL): Uint8Array => readFileSync(url);
const fontDir = dirname(fileURLToPath(new URL("../dist/fonts/LICENSE-Noto.txt", import.meta.url)));
const font = (file: string): ScriptFont => {
  const found = scriptFonts.find((f) => f.file === file);
  if (!found) throw new Error(`no script font ${file}`);
  return found;
};

const DOC = `#set page(width: 12cm, height: auto)
= শিরোনাম (Heading)
আমি বাংলায় গান গাই। English with বাংলা mixed in.

#set text(lang: "ar")
مرحبا بالعالم. هذا اختبار للنص العربي ١٢٣ and 123.
`;

/** Registered id by file name. */
const ids = new Map<string, number>();
const id = (file: string): number => ids.get(file) ?? -1;
const files = (missing: number[]): string[] =>
  missing.map((n) => [...ids].find(([, i]) => i === n)?.[0] ?? `unknown ${n}`).sort();
const load = (file: string, from = file): void => Engine.load_font(id(file), bytes(font(from).url));

beforeAll(() => {
  // The base fonts first (newEngine), as the worker adds them.
  newEngine().free();
  for (const f of scriptFonts) ids.set(f.file, Engine.register_font(f.info));
});

describe("the script font registry", () => {
  it("covers Arabic, Bengali and Devanagari in regular and bold", () => {
    expect(scriptFonts.map((f) => [f.scripts.join(), f.family, f.file])).toEqual([
      ["Arab", "Noto Naskh Arabic", "NotoNaskhArabic-Regular.ttf"],
      ["Arab", "Noto Naskh Arabic", "NotoNaskhArabic-Bold.ttf"],
      ["Beng", "Noto Serif Bengali", "NotoSerifBengali-Regular.ttf"],
      ["Beng", "Noto Serif Bengali", "NotoSerifBengali-Bold.ttf"],
      ["Deva", "Noto Serif Devanagari", "NotoSerifDevanagari-Regular.ttf"],
      ["Deva", "Noto Serif Devanagari", "NotoSerifDevanagari-Bold.ttf"],
    ]);
  });

  it("holds what font_info computes for each file", () => {
    for (const font of scriptFonts) expect(Engine.font_info(bytes(font.url))).toBe(font.info);
  });
});

describe("lazy fonts", () => {
  it("gives the same id for the same info", () => {
    expect(new Set(ids.values()).size).toBe(scriptFonts.length);
    const bengali = "NotoSerifBengali-Regular.ttf";
    expect(Engine.register_font(font(bengali).info)).toBe(id(bengali));
  });

  it("rejects invalid info", () => {
    expect(() => Engine.register_font("{")).toThrow(/invalid font info/);
    expect(() => Engine.register_font("[]")).toThrow(/no faces/);
  });

  it("reports the faces a compile wanted until they are loaded", () => {
    const engine = new Engine();
    engine.set_source("/main.typ", DOC);
    const first = engine.compile_svg_changed();
    expect(first.ok).toBe(true);
    const wanted = ["NotoNaskhArabic-Regular.ttf", "NotoSerifBengali-Bold.ttf", "NotoSerifBengali-Regular.ttf"];
    expect(files(first.missingFonts)).toEqual(wanted);
    // A warm compile reuses cached layout; comemo's validation still asks for the fonts.
    const again = engine.compile_svg_changed();
    expect(again.changed).toEqual([]);
    expect(files(again.missingFonts)).toEqual(wanted);
    // HTML has no layout outside frames: the browser draws the text.
    expect(engine.compile_html().missingFonts).toEqual([]);

    for (const file of wanted) load(file);
    const loaded = engine.compile_svg_changed();
    expect(loaded.missingFonts).toEqual([]);
    expect(loaded.changed?.map((p) => p.index)).toEqual([0]);
    engine.reset_pages();
    const svg = engine.compile_svg_changed().changed?.map((p) => p.svg);
    expect(svg).toEqual(nativeSvgPages(DOC, [fontDir]));
    engine.free();
  });

  it("only takes the bytes the info came from", () => {
    const bold = "NotoSerifDevanagari-Bold.ttf";
    expect(() => load(bold, "NotoSerifDevanagari-Regular.ttf")).toThrow(/aren't the file it was registered with/);
    expect(() => Engine.load_font(999, new Uint8Array())).toThrow(/no font registered/);
    load(bold);
    // Loading again is a no-op.
    load(bold);
  });

  it("serves fonts selected by family as well as by fallback", () => {
    const engine = new Engine();
    engine.set_source("/main.typ", `#text(font: "Noto Serif Devanagari", weight: "bold")[नमस्ते]`);
    expect(engine.compile_svg_changed().missingFonts).toEqual([]);
    engine.set_source("/main.typ", `#text(font: "Noto Serif Devanagari")[नमस्ते]`);
    expect(files(engine.compile_svg_changed().missingFonts)).toEqual(["NotoSerifDevanagari-Regular.ttf"]);
    engine.free();
  });
});
