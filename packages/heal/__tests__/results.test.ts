// What `heal` returns besides the source: patches and their reasons, the
// position map, open frames, stable offset, errors, and custom handlers.

import { describe, expect, it } from "vitest";
import { type HealHandler, heal } from "../src";
import { syntaxErrors } from "./support/oracle";

describe("patches", () => {
  it("a closer is an insertion, a cut a deletion", () => {
    expect(heal("a *b").patches).toEqual([
      { original: { from: 4, to: 4 }, result: { from: 4, to: 5 }, reason: "heal:close" },
    ]);
    expect(heal("a #let x = ").patches).toEqual([
      { original: { from: 2, to: 11 }, result: { from: 2, to: 2 }, reason: "heal:cut" },
    ]);
    // Cutting and closing at once is one change, named for the closer.
    expect(heal("#box[a #let x = ")).toMatchObject({
      source: "#box[a ]",
      patches: [{ original: { from: 7, to: 16 }, result: { from: 7, to: 8 }, reason: "heal:close" }],
      openFrames: [{ frame: "content", open: 4 }],
    });
  });

  it("lint fixes come first, each with its rule, in normalized-text offsets", () => {
    const r = heal("# H\n\nx **b** y\n\nz *c");
    expect(r.source).toBe("= H\n\nx *b* y\n\nz *c*");
    expect(r.patches).toEqual([
      { original: { from: 0, to: 1 }, result: { from: 0, to: 1 }, reason: "lint:markdown-heading" },
      { original: { from: 7, to: 9 }, result: { from: 7, to: 8 }, reason: "lint:markdown-bold" },
      { original: { from: 10, to: 12 }, result: { from: 9, to: 10 }, reason: "lint:markdown-bold" },
      { original: { from: 20, to: 20 }, result: { from: 18, to: 19 }, reason: "heal:close" },
    ]);
    expect(r.stableOffset).toBe(14);
    expect(r.openFrames).toEqual([{ frame: "strong", open: 18 }]);
  });

  it("behind a fence, patches are in normalized offsets and findings and frames in input offsets", () => {
    const r = heal("```typst\n# H\n\n*a");
    expect(r.source).toBe("= H\n\n*a*");
    expect(r.patches).toEqual([
      { original: { from: 0, to: 1 }, result: { from: 0, to: 1 }, reason: "lint:markdown-heading" },
      { original: { from: 7, to: 7 }, result: { from: 7, to: 8 }, reason: "heal:close" },
    ]);
    expect(r.findings.map((f) => [f.rule, f.start, f.end])).toEqual([["markdown-heading", 9, 10]]);
    expect(r.openFrames).toEqual([{ frame: "strong", open: 14 }]);
    expect(r.stableOffset).toBe(5);
  });

  it("a complete document has no patches unless lint changes it", () => {
    expect(heal("= A\n\n*b*\n", { final: true }).patches).toEqual([]);
  });
});

describe("map", () => {
  it("maps across a removed fence and a closer", () => {
    const r = heal("```typst\nab *c");
    expect(r.source).toBe("ab *c*");
    // Source 0 is input 9, after the fence; with assoc -1, before it.
    expect([0, 1, 5, 6].map((p) => r.map.toInput(p))).toEqual([9, 10, 14, 14]);
    expect([0, 1, 5].map((p) => r.map.toInput(p, -1))).toEqual([0, 10, 14]);
    // Input inside the fence maps to the start; past the end, to the end.
    expect([0, 8, 9, 10, 14, 15, 99].map((p) => r.map.toSource(p))).toEqual([0, 0, 0, 1, 6, 6, 6]);
  });

  it("maps across a cut", () => {
    const r = heal("a #let x = ");
    expect([0, 1, 2].map((p) => r.map.toInput(p))).toEqual([0, 1, 11]);
    expect(r.map.toInput(2, -1)).toBe(2);
    expect(r.map.toSource(5)).toBe(2);
  });
});

describe("final mode", () => {
  it("reports what is still open or incomplete at the end, and repairs nothing", () => {
    const r = heal("a *b\n\n#box[c", { final: true });
    expect(r.source).toBe("a \\*b\n\n#box[c");
    expect(r.stableOffset).toBe(r.source.length);
    expect(r.errors).toEqual([{ start: 10, end: 11, message: "unclosed delimiter" }]);
    expect(heal("x #let y = ", { final: true }).errors).toEqual([
      { start: 2, end: 11, message: "expected expression" },
    ]);
  });

  it("drops errors that a lint fix repairs and keeps the rest", () => {
    const r = heal("a ] b\n\n#f(a: 1, a: 2)\n\nc", { final: true });
    expect(r.source).toBe("a \\] b\n\n#f(a: 1, a: 2)\n\nc");
    expect(r.errors).toEqual([{ start: 16, end: 17, message: "duplicate argument: a" }]);
  });

  it("while streaming, only errors in settled text are reported", () => {
    expect(heal("#f(a: 1, a: 2)").errors).toEqual([]);
    expect(heal("#f(a: 1, a: 2)\n\nnext\n\nmore").errors).toEqual([
      { start: 9, end: 10, message: "duplicate argument: a" },
    ]);
  });
});

describe("handlers", () => {
  const handlers: HealHandler[] = [
    { name: "late", priority: 60, phase: "settled", run: ({ from }) => [{ from, to: from + 1, insert: "X" }] },
    {
      name: "early",
      priority: 10,
      phase: "settled",
      // The second change reaches past the settled range: it is dropped.
      run: ({ from, to }) => [
        { from, to: from, insert: "Y" },
        { from: to, to: to + 5, insert: "Z" },
      ],
    },
    {
      name: "second",
      priority: 2,
      phase: "output",
      run: ({ text }) => [{ from: 0, to: 0, insert: `<${text.length}>` }],
    },
    {
      name: "first",
      phase: "output",
      priority: 1,
      run: ({ text }) => [{ from: text.length, to: text.length, insert: "!" }],
    },
  ];

  it("run by priority; settled changes stay inside the settled range; output handlers all see the same output", () => {
    const r = heal("ab\n\ncd", { handlers });
    expect(r.source).toBe("<7>YXb\n\ncd!");
    expect(r.findings).toEqual([
      {
        rule: "early",
        severity: "fix",
        start: 0,
        end: 0,
        message: "early",
        changes: [{ from: 0, to: 0, insert: "Y" }],
      },
      { rule: "late", severity: "fix", start: 0, end: 1, message: "late", changes: [{ from: 0, to: 1, insert: "X" }] },
    ]);
    expect(r.patches.map((p) => [p.original.from, p.original.to, p.reason])).toEqual([
      [0, 0, "lint:early"],
      [0, 1, "lint:late"],
      [0, 0, "handler"],
      [6, 6, "handler"],
    ]);
  });

  it("settled handlers see the mode at a position; output handlers see markup", () => {
    const seen: string[] = [];
    heal("a $x$ b\n\nc\n\nd e", {
      handlers: [
        {
          name: "s",
          phase: "settled",
          run: ({ modeAt, from }) => {
            seen.push(`s@${from}:${modeAt(0)},${modeAt(3)}`);
            return [];
          },
        },
        {
          name: "o",
          phase: "output",
          run: ({ modeAt, final }) => {
            seen.push(`o:${modeAt(3)},${final}`);
            return [];
          },
        },
      ],
    });
    expect(seen).toEqual(["s@0:markup,math", "o:markup,false"]);
  });

  it("known bug still reproduces: output handlers leave earlier patches in pre-handler coordinates", () => {
    // `b` is input 1 and source 5; the map says 5.
    const r = heal("ab *c", {
      handlers: [{ name: "pre", phase: "output", run: () => [{ from: 0, to: 0, insert: "<<>>" }] }],
    });
    expect(r.source).toBe("<<>>ab *c*");
    expect(r.map.toInput(5), "fixed? assert toInput(5) === 1 instead").not.toBe(1);
  });
});

describe("streaming range", () => {
  it("is given in input offsets, also behind a fence", () => {
    // Input [13, 16) is `*cd`, normalized [4, 7).
    const r = heal("```typst\nab\n\n*cd", { streamingRange: { from: 13, to: 16 } });
    expect(r.source).toBe("ab\n\n*cd*");
    expect(r.stableOffset).toBe(4);
  });
});

describe("repair fallbacks", () => {
  it("a closer that would merge with the last token gets a space first", () => {
    expect(heal("#box[a \\").source).toBe("#box[a \\ ]");
    expect(heal("*a \\").source).toBe("*a \\ *");
  });

  it("closers that keep merging: the outermost open construct goes instead", () => {
    const input = `#f(${"[".repeat(300)}x\\`;
    const r = heal(input);
    expect(syntaxErrors(r.source)).toEqual([]);
    expect(r.openFrames).toHaveLength(301);
    expect(r.source.endsWith(`${"]".repeat(300)})`)).toBe(true);
  });

  it("nesting deeper than Typst allows can't be closed: it is cut back to the start", () => {
    for (const input of [`${"#box[".repeat(300)}x`, `${"#(".repeat(300)}1 \\`, `${"#{".repeat(300)}x\\`]) {
      expect(heal(input)).toMatchObject({ source: "", openFrames: [] });
    }
    // The same inside a streaming region keeps the text before it.
    const deep = `Intro\n\n${"#box[".repeat(300)}x`;
    expect(heal(deep, { streamingRange: { from: 7, to: deep.length } }).source).toBe("Intro\n\n");
  });
});

describe("streaming range separators", () => {
  // The first separator after the healed region that keeps the rest of the
  // document parsing no worse than without the region.
  const cases: [input: string, from: number, to: number, healed: string][] = [
    ["#(foo)\n\n~nbsp *strong texe)\n", 7, 25, "#(foo)\n\n~nbsp *strong tex*\u200be)\n"],
    ['Text with $#(my-var: x, "k": 1in math.\n', 19, 30, 'Text with $#(my-var: x, "k": 1 in math.\n'],
    ["#{\n  -context (a: 1, ..rep\n}\n", 7, 25, "#{\n  -context (a: 1, )\np\n}\n"],
  ];
  it.each(cases)("%j", (input, from, to, healed) => {
    const r = heal(input, { streamingRange: { from, to } });
    expect(r.source).toBe(healed);
    const without = input.slice(0, from) + input.slice(to);
    expect(syntaxErrors(r.source).length).toBeLessThanOrEqual(syntaxErrors(without).length);
  });
});
