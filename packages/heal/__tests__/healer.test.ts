// The incremental Healer API surface.

import { describe, expect, it } from "vitest";
import { createHealer, heal } from "../src";
import { syntaxErrors } from "./support/oracle";

describe("createHealer", () => {
  it("push / set / result / input", () => {
    const h = createHealer();
    h.push("= Title\n\nSome *bo");
    expect(h.result().source).toBe("= Title\n\nSome *bo*");
    expect(h.input).toBe("= Title\n\nSome *bo");
    expect(h.set("= Title\n\nSome *bold* text").source).toBe("= Title\n\nSome *bold* text");
  });

  it("set with a non-prefix (regenerate) re-heals from the change", () => {
    const h = createHealer();
    h.set("= A\n\n#box[one");
    expect(h.set("= B\n\n#box[two").source).toBe("= B\n\n#box[two]");
  });

  it("finish switches to final mode: lint the tail, no repair", () => {
    const h = createHealer();
    h.push("Some **bold** text");
    expect(h.result().source).toBe("Some **bold** text");
    const done = h.finish();
    expect(done.source).toBe("Some *bold* text");
    expect(done.stableOffset).toBe(done.source.length);
  });

  it("finish reports what a truncated stream left broken instead of hiding it", () => {
    const h = createHealer();
    h.push("Some *bold");
    expect(h.finish().errors).toEqual([{ start: 5, end: 6, message: "unclosed delimiter" }]);
  });

  it("setStreamingRange heals a region written into an existing document", () => {
    const doc = "= Quiz\n\n1. First question\n\n3. Third question\n";
    const insertAt = doc.indexOf("3.");
    const h = createHealer();
    h.set(doc);
    h.setStreamingRange({ from: insertAt, to: insertAt });
    const partial = "2. Second *quest";
    const r = h.applyEdit({ from: insertAt, to: insertAt, insert: partial });
    // A zero-width space keeps `*` + `3.` from reading as a word-internal star.
    expect(r.source).toBe(`${doc.slice(0, insertAt)}2. Second *quest*\u200b${doc.slice(insertAt)}`);
    expect(syntaxErrors(r.source)).toEqual([]);
    expect(r.source.endsWith("3. Third question\n")).toBe(true);
    // Done writing: heal the whole document normally again.
    h.applyEdit({ from: insertAt + partial.length, to: insertAt + partial.length, insert: "ion*\n\n" });
    expect(h.setStreamingRange(null).source).toBe(
      "= Quiz\n\n1. First question\n\n2. Second *question*\n\n3. Third question\n",
    );
  });

  it("setStreamingRange on a finished document streams into it, and the rest shows as final mode healed it", () => {
    // Lint fixes on both sides: `m/s$^2$` (math-lone-script) and `**` (markdown-bold).
    const doc = "= Units\n\nSpeed in m/s$^2$.\n\n#question[Old]\n\nA **bold** end, m/s$^2$.\n";
    const final = heal(doc, { final: true }).source;
    expect(final).toBe('= Units\n\nSpeed in m/s$""^2$.\n\n#question[Old]\n\nA *bold* end, m/s$""^2$.\n');
    const from = doc.indexOf("#question");
    const to = doc.indexOf("\n\nA **");
    const h = createHealer();
    h.set(doc);
    h.finish();
    h.setStreamingRange({ from, to });
    let r = h.applyEdit({ from, to, insert: "#question(points: 2)[New *wor" });
    const suffix = final.slice(final.indexOf("\n\nA *bold*"));
    expect(r.source).toBe(`${final.slice(0, final.indexOf("#question"))}#question(points: 2)[New *wor*]${suffix}`);
    expect(r.suffixOffset).toBe(r.source.length - suffix.length);
    expect(syntaxErrors(r.source)).toEqual([]);
    // The range moves with the edit; text typed at its end extends it.
    expect(h.streamingRange).toEqual({ from, to: from + "#question(points: 2)[New *wor".length });
    const end = h.streamingRange?.to as number;
    r = h.applyEdit({ from: end, to: end, insert: "ds*]" });
    expect(h.streamingRange).toEqual({ from, to: end + 4 });
    expect(r.source.endsWith(suffix)).toBe(true);
    // Done writing: final mode again, the whole document.
    const done = h.finish();
    expect(done.source).toBe(final.replace("#question[Old]", "#question(points: 2)[New *words*]"));
    expect(done.suffixOffset).toBeNull();
    expect(h.streamingRange).toBeNull();
  });

  it("reset starts over", () => {
    const h = createHealer();
    h.push("#box[a");
    h.reset("$x^");
    expect(h.result().source).toBe("$x$");
    expect(h.input).toBe("$x^");
  });
});

describe("heal options", () => {
  it("unwrapFences: never keeps the fence as a raw block", () => {
    expect(heal("```typst\n= A", { unwrapFences: "never" }).source).toBe("```typst\n= A```");
  });

  it("errors in settled text that lint can't fix are reported", () => {
    const r = heal("#f(a: 1, a: 2)\n\nnext\n\nmore");
    expect(r.errors.map((e) => e.message)).toContain("duplicate argument: a");
  });
});
