// The catalogue's index, the plugin's facets, and the preamble compiled by
// engine-wasm: the HTML target marks text in another font with its family,
// and nothing else changes.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { FontCatalogueIndex } from "@typstream/core";
import { Engine, initSync } from "@typstream/engine-wasm";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { describe, expect, it } from "vitest";
import { createGoogleFonts, GOOGLE_FONTS_INDEX, googleFonts, googleFontsPreamble } from "../src/index";

const index = JSON.parse(readFileSync(new URL(GOOGLE_FONTS_INDEX), "utf8")) as FontCatalogueIndex & {
  commit: string;
};

describe("the catalogue", () => {
  it("is a version 1 index of the Google Fonts repository at one commit, served by jsDelivr", () => {
    expect(index.version).toBe(1);
    expect(index.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(index.base).toBe(`https://cdn.jsdelivr.net/gh/google/fonts@${index.commit}/`);
    expect(Object.keys(index.families).length).toBeGreaterThan(1900);
  });

  it("keys families by their names lowercased, as Typst compares them", () => {
    for (const [key, family] of Object.entries(index.families)) expect(key).toBe(family.name.toLowerCase());
    for (const name of ["Inter", "Lora", "Open Sans", "Playfair Display", "Noto Sans", "Roboto"])
      expect(index.families[name.toLowerCase()]?.name).toBe(name);
  });

  it("lists font files Typst reads and jsDelivr serves (20 MB at most)", () => {
    for (const family of Object.values(index.families)) {
      expect(family.files.length).toBeGreaterThan(0);
      for (const file of family.files) {
        expect(file.path).toMatch(/^(ofl|apache|ufl)\/[^/]+\/[^/]+\.(ttf|otf)$/);
        expect(["normal", "italic"]).toContain(file.style);
        const [min, max] = Array.isArray(file.weight) ? file.weight : [file.weight, file.weight];
        expect(min).toBeGreaterThanOrEqual(1);
        expect(max).toBeLessThanOrEqual(1000);
        expect(file.bytes).toBeLessThanOrEqual(20_000_000);
      }
    }
  });

  it("gives variable fonts their weight axis", () => {
    expect(index.families.inter?.files).toEqual([
      expect.objectContaining({ path: "ofl/inter/Inter[opsz,wght].ttf", style: "normal", weight: [100, 900] }),
      expect.objectContaining({ path: "ofl/inter/Inter-Italic[opsz,wght].ttf", style: "italic", weight: [100, 900] }),
    ]);
  });

  it("has every family the prompt rules suggest (the quoted names)", () => {
    const quoted = [...(googleFonts.prompt?.rules ?? []).join("\n").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(quoted.length).toBeGreaterThan(5);
    expect(quoted.filter((name) => !index.families[name.toLowerCase()])).toEqual([]);
  });
});

describe("the plugin", () => {
  it("names the catalogue, the preamble, the attribute it writes and prompt rules", () => {
    expect(googleFonts.key).toBe("google-fonts");
    expect(googleFonts.engine?.fontCatalogues).toEqual([{ index: GOOGLE_FONTS_INDEX }]);
    expect(googleFonts.engine?.preamble).toBe(googleFontsPreamble);
    expect(googleFonts.sanitize?.allowAttrs).toEqual({ span: ["data-typstream-font"] });
    expect(googleFonts.prompt?.rules?.length).toBeGreaterThan(0);
  });

  it("takes another index and a size limit", () => {
    const plugin = createGoogleFonts({ index: "https://example.com/fonts.json", maxBytes: 1e7 });
    expect(plugin.key).toBe("google-fonts");
    expect(plugin.engine?.fontCatalogues).toEqual([{ index: "https://example.com/fonts.json", maxBytes: 1e7 }]);
  });
});

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });
for (const url of baseFonts) Engine.add_font(new Uint8Array(readFileSync(url)));

const html = (source: string, preamble = googleFontsPreamble): string => {
  const engine = new Engine();
  engine.set_source("/main.typ", preamble + source);
  const r = engine.compile_html();
  engine.free();
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return (r.html ?? "").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
};

const svg = (source: string, preamble: string): string[] => {
  const engine = new Engine();
  engine.set_source("/main.typ", preamble + source);
  const r = engine.compile_svg_changed();
  engine.free();
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return (r.changed ?? []).map((p) => p.svg);
};

describe("the preamble, in the HTML target", () => {
  it("marks text set in another family with it, lowercased", () => {
    expect(html('#set text(font: "Lora")\n= Title\nSome *bold* text.')).toBe(
      '<h2><span data-typstream-font="lora">Title</span></h2>' +
        '<p><span data-typstream-font="lora">Some</span> <strong><span data-typstream-font="lora">bold</span></strong>' +
        ' <span data-typstream-font="lora">text.</span></p>',
    );
  });

  it("marks a passage, a family list's first family and a family with `covers`", () => {
    const out = html(
      'A #text(font: "Caveat")[note], #text(font: ("Lora", "Noto Sans"))[list] and #text(font: (name: "Inter", covers: "latin-in-cjk"))[covers].',
    );
    expect(out).toContain('<span data-typstream-font="caveat">note</span>');
    expect(out).toContain('<span data-typstream-font="lora">list</span>');
    expect(out).toContain('<span data-typstream-font="inter">covers</span>');
    expect(out).toMatch(/^<p>A <span/);
  });

  it("marks headings a show-set rule gives a family", () => {
    expect(html('#show heading: set text(font: "Playfair Display")\n= Title\nBody.')).toBe(
      '<h2><span data-typstream-font="playfair display">Title</span></h2><p>Body.</p>',
    );
  });

  it("leaves text in the document's own font as it was", () => {
    const source = "= Title\nSome _text_, a list:\n- one\n- two\n\n#table(columns: 2, [a], [b])";
    expect(html(source)).toBe(html(source, ""));
  });

  it("keeps equations to their math font", () => {
    const equations = '$x^2 + "text"$, $(a+b)/c$, $vec(a, b) dot.op x_i^2$ and $ integral_0^1 x dif x = 1/2 $';
    const math = (s: string) => s.match(/<math[\s\S]*?<\/math>/g) ?? [];
    // The show rule's `context` puts a script's token in an `mrow` of its own, which MathML draws the same.
    const unwrap = (s: string): string => {
      const out = s.replace(/<mrow>(<(m[a-z]+)(?: [^>]*)?>[^<]*<\/\2>)<\/mrow>/g, "$1");
      return out === s ? s : unwrap(out);
    };
    const marked = math(html(`#set text(font: "Lora")\n${equations}`));
    expect(marked).toHaveLength(4);
    for (const m of marked) expect(m).not.toContain("data-typstream-font");
    expect(marked.map(unwrap)).toEqual(math(html(equations, "")));
  });

  it("leaves frames, which Typst draws itself, alone", () => {
    const out = html('#set text(font: "Lora")\n#html.frame(box[framed #text(font: "Caveat")[x]])');
    expect(out).toMatch(/^<svg/);
    expect(out).not.toContain("data-typstream-font");
  });
});

describe("the preamble, in the paged target", () => {
  it("changes nothing", () => {
    const source = '#set text(font: "Lora")\n= Title\nSome *bold* text and $x^2$.';
    expect(svg(source, googleFontsPreamble)).toEqual(svg(source, ""));
  });
});
