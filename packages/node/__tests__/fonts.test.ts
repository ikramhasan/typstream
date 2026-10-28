// The server's fonts are the browser engine's (#128): the bundled set is exactly engine-wasm's base and extra
// fonts, file for file, so a document rendered here picks the faces it picks in the browser.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseFonts, extraFonts } from "@typstream/engine-wasm/fonts";
import { describe, expect, it } from "vitest";
import { bundledFontDir } from "../src/fonts";

describe("bundled fonts", () => {
  it("are engine-wasm's base and extra fonts, byte for byte", () => {
    const browser = [...baseFonts, ...extraFonts.map((font) => font.url)].map((url) => fileURLToPath(url));
    const server = readdirSync(bundledFontDir()).filter((name) => /\.(ttf|otf)$/.test(name));
    expect(server.sort()).toEqual(browser.map((path) => basename(path)).sort());
    for (const path of browser)
      expect(readFileSync(join(bundledFontDir(), basename(path))).equals(readFileSync(path)), basename(path)).toBe(
        true,
      );
  });

  it("all have TrueType outlines, which Word embeds (#118)", () => {
    for (const name of readdirSync(bundledFontDir()).filter((n) => /\.(ttf|otf)$/.test(n))) {
      const tag = readFileSync(join(bundledFontDir(), name)).subarray(0, 4).toString("latin1");
      expect(tag, name).not.toBe("OTTO");
    }
  });
});
