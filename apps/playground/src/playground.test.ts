import { joinStream, parseStream } from "@typstream/corpus/stream";
import { heal, normalize } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import { decodeState, defaultState, encodeState, type PlaygroundState } from "./hash";
import { healedMarks, rawMarks, runs } from "./marks";
import { caseFiles, slug } from "./save";
import { HealSession } from "./session";
import { looksLikeStream, prefixLengths, splitStream } from "./stream";

const chunks = [
  { t: 0, text: "#table(columns: 2, " },
  { t: 40, text: "[a], [b" },
  { t: 90, text: "])\nDone." },
];

describe("hash state", () => {
  it("round-trips every field", async () => {
    const state: PlaygroundState = {
      source: { kind: "doc", text: "= Hëllo 🌍\n#table(columns: 2, [a], [b" },
      seed: 7,
      split: "tokens",
      at: 12,
      final: true,
      heal: {
        dropIncompleteRules: false,
        unwrapFences: "never",
        lint: { "email-at": "off", "currency-dollar": "fix" },
      },
      render: { mode: "off", target: "paged", compat: false },
    };
    expect(await decodeState(await encodeState(state))).toEqual(state);
    const stream: PlaygroundState = {
      ...defaultState(),
      source: { kind: "stream", jsonl: '{"t":0,"text":"a"}\n', name: "x.jsonl" },
    };
    expect(await decodeState(`#${await encodeState(stream)}`)).toEqual(stream);
  });

  it("leaves defaults out of the hash", async () => {
    expect(await encodeState(defaultState())).toBe("corpus=edu%2Fquiz-mcq-geography");
  });

  it("falls back to defaults on a mangled hash", async () => {
    const state = await decodeState("#doc=%%%&split=bogus&at=-3&lint=nope:fix,email-at:loud&render=dom&target=pdf");
    expect(state).toEqual({ ...defaultState(), at: 0 });
  });
});

describe("stream splitting", () => {
  it("keeps the text and the arrival times", () => {
    for (const split of ["chunks", "tokens", "chars"] as const) {
      const parts = splitStream(chunks, split);
      expect(joinStream(parts)).toBe(joinStream(chunks));
      expect(parts.map((c) => c.t)).toEqual([...parts.map((c) => c.t)].sort((a, b) => a - b));
    }
    expect(splitStream([{ t: 0, text: "a🌍" }], "chars").map((c) => c.text)).toEqual(["a", "🌍"]);
  });

  it("measures prefixes in UTF-16 units", () => {
    expect(
      prefixLengths([
        { t: 0, text: "a🌍" },
        { t: 1, text: "b" },
      ]),
    ).toEqual([0, 3, 4]);
  });

  it("tells streams from documents", () => {
    expect(looksLikeStream('{"t":0,"text":"#set"}\n{"t":5,"text":" page()"}\n')).toBe(true);
    expect(looksLikeStream("= Heading\n")).toBe(false);
    expect(looksLikeStream('{"t":0}\n')).toBe(false);
  });
});

describe("marks", () => {
  it("splits text into runs at marks and the settled boundary", () => {
    const parts = runs(
      10,
      [
        { from: 2, to: 4, kind: "patch", title: "p" },
        { from: 6, to: 6, kind: "patch", title: "c" },
      ],
      5,
    );
    expect(parts.map((r) => [r.from, r.to, r.caret, r.unsettled, r.marks.length])).toEqual([
      [0, 2, false, false, 0],
      [2, 4, false, false, 1],
      [4, 5, false, false, 0],
      [5, 6, false, true, 0],
      [6, 6, true, true, 1],
      [6, 10, false, true, 0],
    ]);
  });

  it("places heal patches in both panes", () => {
    const input = "#table(columns: 2, [a], [b";
    const result = heal(input);
    const norm = normalize(input, { streaming: true });
    const healed = healedMarks(result, norm);
    // Every inserted closer is highlighted in the healed source.
    expect(healed.map((m) => result.source.slice(m.from, m.to)).join("")).toBe(result.source.slice(input.length));
    expect(rawMarks(result, norm).filter((m) => m.kind === "patch")).toHaveLength(healed.length);
  });

  it("maps patches past a stripped fence back to the raw input", () => {
    const input = "```typst\n*bold";
    const result = heal(input);
    const norm = normalize(input, { streaming: true });
    const marks = rawMarks(result, norm);
    expect(marks.some((m) => m.kind === "normalize")).toBe(true);
    for (const m of marks.filter((m) => m.kind === "patch")) expect(m.from).toBeGreaterThanOrEqual(input.indexOf("*"));
  });
});

describe("HealSession", () => {
  const source = joinStream(chunks);
  const run = (path: number[], final = false) => {
    const session = new HealSession(chunks, source, prefixLengths(chunks), {});
    return path.map((at) => session.goto(at, final));
  };

  it("matches stateless healing whichever way it gets there", () => {
    for (const path of [
      [0, 1, 2, 3],
      [3, 1, 2],
      [2, 0, 3],
    ]) {
      for (const step of run(path)) expect(step.result.source).toBe(heal(step.input).source);
    }
    const [finished] = run([2], true);
    expect(finished?.result.source).toBe(heal(source.slice(0, prefixLengths(chunks)[2]), { final: true }).source);
  });

  it("pushes forward and sets otherwise", () => {
    expect(run([1, 3, 0]).map((s) => s.op)).toEqual(["push ×1", "push ×2", "set"]);
  });
});

describe("save as corpus case", () => {
  it("slugs names", () => {
    expect(slug("My Case.stream.jsonl")).toBe("my-case");
    expect(slug("!!!")).toBe("case");
  });

  it("writes files the corpus can read back", () => {
    const files = caseFiles({
      name: "x",
      category: "quiz",
      chunks,
      stream: { source: "synthetic", options: { seed: 3 } },
      notes: "",
    });
    expect(files.typ).toBe(joinStream(chunks));
    expect(parseStream(files.jsonl)).toEqual(chunks);
    expect(JSON.parse(files.meta)).toEqual({
      x: { category: "quiz", stream: { source: "synthetic", options: { seed: 3 } } },
    });
  });
});
