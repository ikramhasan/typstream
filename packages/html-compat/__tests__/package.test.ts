import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { generate } from "../scripts/embed.mjs";
import { HTML_COMPAT_PATH, htmlCompat, htmlCompatCss, htmlCompatPreamble, htmlCompatSource } from "../src/index";

describe("package", () => {
  it("embeds the current prelude and CSS (run `pnpm embed` after editing them)", () => {
    expect(readFileSync(new URL("../src/assets.generated.ts", import.meta.url), "utf8")).toBe(generate());
  });

  it("mounts the prelude where the preamble imports it", () => {
    expect(htmlCompatPreamble).toContain(`"${HTML_COMPAT_PATH}"`);
    expect(htmlCompat.engine?.files?.[HTML_COMPAT_PATH]).toBe(htmlCompatSource);
    expect(htmlCompat.engine?.preamble).toBe(htmlCompatPreamble);
  });

  it("scopes every CSS rule to the renderer root", () => {
    const selectors = htmlCompatCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0]?.trim())
      .filter((s): s is string => !!s);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^:where\(\.typstream[ )]/);
    }
  });
});
