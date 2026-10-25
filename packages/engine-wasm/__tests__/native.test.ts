// The wasm engine against native `typst compile` 0.15.1 with the same fonts.
import { describe, expect, it } from "vitest";
import { benchDoc, SMOKE } from "./support/documents.js";
import { newEngine } from "./support/engine.js";
import { nativeHtml, nativeSvgPages } from "./support/native.js";

const engine = newEngine();

const DOCUMENTS: Record<string, string> = {
  smoke: SMOKE,
  "six pages": benchDoc(),
  "explicit page breaks": "= One\n#pagebreak()\n= Two\n#pagebreak()\n#pagebreak()\n= Four",
  "letter, two columns": `#set page(paper: "us-letter", columns: 2)\n${"#lorem(120)\n\n".repeat(8)}`,
  "worksheet with emoji and German": `#set text(lang: "de")
= Arbeitsblatt 😀
#for i in range(1, 30) [
  + Berechne $#i^2 + #(i + 1)$ und erkläre den Lösungsweg. #lorem(12)
]`,
};

describe.each(Object.entries(DOCUMENTS))("%s", (_name, source) => {
  it("has the same pages as native typst", () => {
    engine.set_source("/main.typ", source);
    engine.reset_pages();
    const result = engine.compile_svg_changed();
    expect(result.ok).toBe(true);
    const native = nativeSvgPages(source);
    expect(result.pageCount).toBe(native.length);
    expect(result.changed?.map((page) => page.svg)).toEqual(native);
  });

  it("has the same HTML as native typst", () => {
    engine.set_source("/main.typ", source);
    const result = engine.compile_html();
    expect(result.ok).toBe(true);
    expect(result.html).toBe(nativeHtml(source));
  });
});
