import { describe, expect, it } from "vitest";
import {
  ALL_SETS,
  formatStream,
  joinStream,
  loadCorpus,
  parseStream,
  replay,
  type StreamChunk,
  streamOf,
  synthesizeStream,
  tokenize,
} from "../src";

const corpus = loadCorpus({ sets: ALL_SETS });

/** No lone surrogates (String#isWellFormed is ES2024). */
const wellFormed = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
    }
  }
  return true;
};

describe("corpus layout", () => {
  it("has the hand-written edu set and the adversarial set", () => {
    expect(corpus.filter((e) => e.set === "edu").length).toBeGreaterThanOrEqual(30);
    expect(corpus.filter((e) => e.set === "adversarial").length).toBeGreaterThanOrEqual(10);
  });

  it("loads only the plain Typst sets by default", () => {
    expect(new Set(loadCorpus().map((e) => e.set))).toEqual(new Set(["edu", "adversarial"]));
  });

  it("keeps model output as recorded, with the prompt it came from (#24)", () => {
    const llm = corpus.filter((e) => e.set === "llm");
    expect(llm.length).toBeGreaterThanOrEqual(50);
    for (const e of llm) {
      expect(e.meta.stream, e.id).toMatchObject({ source: "recorded", model: expect.stringMatching(/^claude-/) });
      expect(e.recordedStream?.length, e.id).toBeGreaterThan(1);
      expect(e.meta.prompt?.request.length, e.id).toBeGreaterThan(10);
      expect(e.name.startsWith(`${e.meta.prompt?.kit}-`), e.id).toBe(true);
      for (const p of e.meta.plugins ?? []) expect(["edu"], e.id).toContain(p);
    }
  });

  it("has documents with render islands, each naming the plugins it compiles with (#28)", () => {
    const islands = corpus.filter((e) => e.set === "islands");
    expect(islands.length).toBeGreaterThanOrEqual(3);
    for (const e of islands) {
      expect(e.meta.plugins, e.id).toContain("mindmap");
      for (const p of e.meta.plugins ?? []) expect(["edu", "mindmap"], e.id).toContain(p);
    }
  });

  it("gives every compiling entry a page count", () => {
    for (const e of corpus) {
      if ((e.meta.expect ?? "ok") === "ok") expect(e.meta.expectedPages, e.id).toBeGreaterThan(0);
      else expect(e.meta.expectedPages, e.id).toBeUndefined();
    }
  });

  it("joins every recorded stream back to its source", () => {
    const streamed = corpus.filter((e) => e.recordedStream);
    expect(streamed.length).toBeGreaterThan(0);
    for (const e of streamed) {
      expect(joinStream(e.recordedStream as StreamChunk[]), e.id).toBe(e.source);
      expect(e.meta.stream, e.id).toBeDefined();
    }
  });

  it("keeps the committed synthetic streams in sync with the synthesizer", () => {
    for (const e of corpus) {
      if (e.meta.stream?.source !== "synthetic") continue;
      expect(e.recordedStream, e.id).toEqual(synthesizeStream(e.source, e.meta.stream.options));
    }
  });
});

describe("synthetic streams", () => {
  it("are lossless, ordered and deterministic for every corpus entry", () => {
    for (const e of corpus) {
      const chunks = synthesizeStream(e.source);
      expect(joinStream(chunks), e.id).toBe(e.source);
      expect(chunks.every((c, i) => c.text.length > 0 && (i === 0 || c.t >= (chunks[i - 1] as StreamChunk).t))).toBe(
        true,
      );
      expect(synthesizeStream(e.source)).toEqual(chunks);
    }
  });

  it("never split a code point, even with astral characters and combining marks", () => {
    // Devanagari with combining signs, built from code points (no literal marks in .ts files).
    const text = `😀 émoji ünïcode 文字 ${String.fromCodePoint(0x92c, 0x93e, 0x902, 0x917, 0x94d, 0x932, 0x93e)} a😀b`;
    for (const token of tokenize(text)) {
      expect(wellFormed(token), JSON.stringify(token)).toBe(true);
    }
    expect(tokenize(text).join("")).toBe(text);
  });

  it("are token-sized: a few characters per chunk on prose", () => {
    const chunks = synthesizeStream("The quick brown fox jumps over the lazy dog. ".repeat(50));
    const mean = chunks.reduce((n, c) => n + c.text.length, 0) / chunks.length;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(16);
  });

  it("change with the seed and honour tokensPerSecond", () => {
    const source = "Some *text* with $x^2$ math.\n".repeat(20);
    expect(synthesizeStream(source, { seed: 2 })).not.toEqual(synthesizeStream(source, { seed: 3 }));
    const slow = synthesizeStream(source, { tokensPerSecond: 10 }).at(-1) as StreamChunk;
    const fast = synthesizeStream(source, { tokensPerSecond: 1000 }).at(-1) as StreamChunk;
    expect(slow.t).toBeGreaterThan(fast.t * 10);
  });

  it("round-trip through the JSONL format", () => {
    const chunks = synthesizeStream('a "quoted"\nline\twith\\escapes 😀');
    expect(parseStream(formatStream(chunks))).toEqual(chunks);
  });

  it("reject malformed lines", () => {
    expect(() => parseStream('{"t": 0, "text": "a"}\n{"text": "b"}\n')).toThrow(/line 2/);
  });
});

describe("replay", () => {
  it("feeds every chunk in order", async () => {
    const entry = corpus.find((e) => e.id === "edu/worksheet-fractions");
    if (!entry) throw new Error("missing entry");
    let text = "";
    const seen: number[] = [];
    await replay(streamOf(entry), (chunk, i) => {
      text += chunk.text;
      seen.push(i);
    });
    expect(text).toBe(entry.source);
    expect(seen).toEqual([...seen.keys()]);
  });

  it("honours timing when given a speed", async () => {
    const chunks = [
      { t: 0, text: "a" },
      { t: 60, text: "b" },
    ];
    const start = Date.now();
    await replay(chunks, () => {}, { speed: 1 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    const fast = Date.now();
    await replay(chunks, () => {}, { speed: 100 });
    expect(Date.now() - fast).toBeLessThan(50);
  });

  it("awaits async callbacks", async () => {
    const order: string[] = [];
    await replay(
      [
        { t: 0, text: "a" },
        { t: 0, text: "b" },
      ],
      async (c) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(c.text);
      },
    );
    expect(order).toEqual(["a", "b"]);
  });
});
