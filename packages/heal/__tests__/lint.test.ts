// Lint rules run on settled text (or the whole document in final mode).

import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { syntaxErrors } from "./support/oracle";

const final = (input: string) => heal(input, { final: true });

describe("fixes", () => {
  it.each([
    ["markdown-heading", "# Heading\n## Sub\nText", "= Heading\n== Sub\nText"],
    ["markdown-bold", "Some **bold** and __strong__ text", "Some *bold* and _strong_ text"],
    ["markdown-link", "See [Typst](https://typst.app) now", 'See #link("https://typst.app")[Typst] now'],
    ["email-at", "Mail me@x.com today", "Mail me\\@x.com today"],
    ["bare-hash", "Item # 5", "Item \\# 5"],
    ["stray-closer", "a ] b", "a \\] b"],
    ["unclosed-delim", "*never closed\n\nnext", "\\*never closed\n\nnext"],
    ["math-lone-script", "Area $100$ m$^2$ of Cl$_2$", 'Area $100$ m$""^2$ of Cl$""_2$'],
  ])("%s", (rule, input, output) => {
    const r = final(input);
    expect(r.source).toBe(output);
    expect(syntaxErrors(r.source)).toEqual([]);
    expect(r.findings.map((f) => f.rule)).toContain(rule);
  });
});

describe("warnings", () => {
  it("currency-dollar reports prices that parsed as math, without changing them", () => {
    const r = final("It costs $5 and $10 today");
    expect(r.source).toBe("It costs $5 and $10 today");
    expect(r.findings).toMatchObject([{ rule: "currency-dollar", severity: "warn" }]);
  });

  it("currency-dollar can be turned into a fix", () => {
    expect(final("It costs $5 and $10 today").source).toBe("It costs $5 and $10 today");
    const r = heal("It costs $5 and $10 today", { final: true, lint: { "currency-dollar": "fix" } });
    expect(r.source).toBe("It costs \\$5 and \\$10 today");
  });

  it("unclosed-block-comment warns that the rest is hidden", () => {
    const r = final("Text /* oops\n\nmore");
    expect(r.findings).toMatchObject([{ rule: "unclosed-block-comment", severity: "warn" }]);
  });
});

describe("scope", () => {
  it("leaves code, math and raw alone", () => {
    for (const input of ['#"**not bold**"', "$a ** b$", "`**raw**`", "```\n# not a heading\n```", "// # comment"]) {
      expect(final(input).source).toBe(input);
    }
  });

  it("doesn't touch the unsettled tail while streaming", () => {
    expect(heal("# Heading").source).not.toBe("= Heading");
    expect(heal("# Heading\n\nnext para").source).toBe("= Heading\n\nnext para");
  });

  it("rules can be switched off", () => {
    expect(heal("# Heading\n\nx", { lint: { "markdown-heading": false } }).source).toBe("# Heading\n\nx");
  });

  it("findings use input offsets", () => {
    const r = heal("```typst\n# Heading\n\nnext");
    expect(r.findings[0]).toMatchObject({ rule: "markdown-heading", start: 9, end: 10 });
  });
});

describe("custom handlers", () => {
  it("settled handlers fix settled text; output handlers see the healed source", () => {
    const r = heal("Fill in [[blank]] here\n\nand *more", {
      handlers: [
        {
          name: "blank-shorthand",
          phase: "settled",
          run: ({ text, from, to }) =>
            [...text.slice(from, to).matchAll(/\[\[blank\]\]/g)].map((m) => ({
              from: from + (m.index as number),
              to: from + (m.index as number) + m[0].length,
              insert: "#box(width: 3em, stroke: (bottom: 0.5pt))",
            })),
        },
        { name: "trailer", phase: "output", run: ({ text }) => [{ from: text.length, to: text.length, insert: "\n" }] },
      ],
    });
    expect(r.source).toBe("Fill in #box(width: 3em, stroke: (bottom: 0.5pt)) here\n\nand *more*\n");
    expect(syntaxErrors(r.source)).toEqual([]);
  });
});
