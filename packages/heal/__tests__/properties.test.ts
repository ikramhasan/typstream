// Invariants of healing (PLAN.md §5.4), checked over every prefix of generated
// documents with Typst's real parser as the oracle.
//
// HEAL_PROPERTY_RUNS=20000 pnpm test:long for a long run.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blockStarts, createHealer, heal } from "../src";
import { effectiveRequirements, recognize } from "../src/recognizer";
import {
  chunksArb,
  documentArb,
  MAX_ATOM_LENGTH,
  prefixes,
  preservedPrefixLength,
  soupArb,
} from "./support/generators";
import { syntaxErrors, syntaxTree } from "./support/oracle";

const RUNS = Number(process.env.HEAL_PROPERTY_RUNS ?? 150);
// Lint off: these properties are about tail repair. Lint has its own tests.
const NO_LINT = {
  lint: {
    "markdown-heading": false,
    "markdown-bold": false,
    "markdown-link": false,
    "email-at": false,
    "bare-hash": false,
    "stray-closer": false,
    "unclosed-delim": false,
    "unclosed-block-comment": false,
    "currency-dollar": false,
    "math-lone-script": false,
    "layout-profile": false,
  },
} as const;

const explain = (input: string, output: string): string =>
  `input:  ${JSON.stringify(input)}\noutput: ${JSON.stringify(output)}\nerrors: ${JSON.stringify(
    syntaxErrors(output),
  )}\n${syntaxTree(output).slice(0, 3000)}`;

describe("recognizer ≡ typst-syntax", () => {
  // A string parses cleanly iff the recognizer reports no hard requirement and no error.
  const verdict = (text: string): boolean => {
    const r = recognize(text);
    return (
      r.errors.length === 0 && effectiveRequirements(r.requirements).every((q) => q.type === "cut" && q.soft === true)
    );
  };

  it("agrees on generated documents and all their prefixes", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc, 3)) {
          const theirs = syntaxErrors(p).length === 0;
          if (verdict(p) !== theirs) {
            throw new Error(`disagreement (oracle clean=${theirs})\n${explain(p, p)}`);
          }
        }
      }),
      { numRuns: Math.ceil(RUNS / 3) },
    );
  });

  it("agrees on random Typst-flavoured character soup", () => {
    fc.assert(
      fc.property(soupArb, (s) => {
        const theirs = syntaxErrors(s).length === 0;
        if (verdict(s) !== theirs) throw new Error(`disagreement (oracle clean=${theirs})\n${explain(s, s)}`);
      }),
      { numRuns: RUNS * 20 },
    );
  });
});

describe("recognizer edge cases ≡ typst-syntax", () => {
  const verdict = (text: string): boolean => {
    const r = recognize(text);
    return (
      r.errors.length === 0 && effectiveRequirements(r.requirements).every((q) => q.type === "cut" && q.soft === true)
    );
  };
  it.each([
    ["nesting deeper than Typst's limit", `${"#box[".repeat(300)}x${"]".repeat(300)}`],
    ["nesting at the limit", `${"#box[".repeat(100)}x${"]".repeat(100)}`],
    ["deep math", `$${"(".repeat(300)}x${")".repeat(300)}$`],
    ["deep code", `#${"(".repeat(300)}1${")".repeat(300)}`],
    ["duplicate argument", "#f(a: 1, a: 2)"],
    ["duplicate key", '#(a: 1, "a": 2)'],
    ["duplicate parameter", "#let f(x, x) = 1"],
    ["duplicate binding", "#let (a, a) = (1, 2)"],
    ["two sinks", "#let f(..a, ..b) = 1"],
    ["non-identifier named argument", "#f(1: 2)"],
    ["imports", '#import "m": a, b.c as d\n#import "m": (x, y)\n#import "m" as n: *'],
    ["shebang", "#!/usr/bin/env typst\nHello"],
  ])("%s", (_, text) => {
    expect(verdict(text)).toBe(syntaxErrors(text).length === 0);
  });
});

describe("tail repair invariants over every prefix", () => {
  it("1. validity: every healed prefix parses without errors", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc)) {
          const out = heal(p, NO_LINT).source;
          if (syntaxErrors(out).length > 0) throw new Error(explain(p, out));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("2. preservation: only a bounded tail of the input is lost", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc, 2)) {
          const r = heal(p, NO_LINT);
          const kept = preservedPrefixLength(p, r.source);
          if (kept < p.length - MAX_ATOM_LENGTH - 2) throw new Error(`lost too much\n${explain(p, r.source)}`);
          // Settled text is passed through untouched.
          if (r.source.slice(0, r.stableOffset) !== p.slice(0, r.stableOffset)) {
            throw new Error(`settled text changed at ${r.stableOffset}\n${explain(p, r.source)}`);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("3. idempotence: healing healed text changes nothing", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc, 2)) {
          const once = heal(p, NO_LINT).source;
          const twice = heal(once, NO_LINT).source;
          if (twice !== once) throw new Error(`not idempotent\n${explain(once, twice)}`);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("4. identity: complete valid documents are not changed", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        expect(heal(doc, { ...NO_LINT, final: true }).source).toBe(doc);
        expect(heal(doc, NO_LINT).source).toBe(doc);
        expect(heal(doc).source).toBe(doc);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("incremental healer", () => {
  it("5. streaming in random chunks ≡ stateless healing, with a monotonic stable offset", () => {
    fc.assert(
      fc.property(
        documentArb.chain((doc) => chunksArb(doc).map((chunks) => ({ doc, chunks }))),
        ({ chunks }) => {
          const healer = createHealer(NO_LINT);
          let text = "";
          let stable = 0;
          for (const chunk of chunks) {
            text += chunk;
            const inc = healer.push(chunk);
            const ref = heal(text, NO_LINT);
            if (inc.source !== ref.source) {
              throw new Error(
                `incremental ≠ stateless\ninc: ${JSON.stringify(inc.source)}\nref: ${JSON.stringify(ref.source)}`,
              );
            }
            const stableInput = inc.map.toInput(inc.stableOffset, -1);
            if (stableInput < stable) throw new Error(`stable offset went back: ${stable} → ${stableInput}`);
            stable = stableInput;
          }
          expect(healer.finish().source).toBe(heal(text, { ...NO_LINT, final: true }).source);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Several blocks, so edits in the middle resync before the end (PLAN.md §5.2).
  const editedArb = fc.tuple(
    fc.array(documentArb, { minLength: 1, maxLength: 3 }).map((docs) => docs.join("\n\n")),
    fc.array(
      fc.record({
        at: fc.nat(),
        del: fc.nat({ max: 12 }),
        insert: fc.oneof(
          fc.constantFrom("", "*", "[", "]", "$", "#f(", "\n\n", "\n", "x", "`", '"', "= ", "#", "/*", "*/", "**"),
          fc.string({ maxLength: 6 }),
        ),
      }),
      { minLength: 1, maxLength: 8 },
    ),
  );
  const comparable = (r: ReturnType<typeof heal>) => ({
    source: r.source,
    stableOffset: r.stableOffset,
    openFrames: r.openFrames,
    errors: r.errors,
    findings: r.findings,
  });

  it.each([
    ["lint off", NO_LINT],
    ["lint on", {}],
  ])("6. random edits anywhere ≡ stateless healing of the edited text (%s)", (_, opts) => {
    fc.assert(
      fc.property(editedArb, ([doc, edits]) => {
        const healer = createHealer(opts);
        healer.set(doc);
        let text = doc;
        for (const e of edits) {
          const from = Math.min(e.at, text.length);
          const to = Math.min(from + e.del, text.length);
          text = text.slice(0, from) + e.insert + text.slice(to);
          const inc = healer.applyEdit({ from, to, insert: e.insert });
          const ref = heal(text, opts);
          try {
            expect(comparable(inc)).toEqual(comparable(ref));
          } catch (err) {
            throw new Error(`edit ${JSON.stringify(e)} → ${JSON.stringify(text)}\n${(err as Error).message}`);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("7. streaming into the middle of a document heals only the written region", () => {
    fc.assert(
      fc.property(documentArb, fc.nat(), fc.nat(), (doc, a, b) => {
        // Pick a block-aligned region and stream it back in.
        const cuts = [0, ...[...doc.matchAll(/\n\n/g)].map((m) => (m.index as number) + 2), doc.length];
        const i = a % (cuts.length - 1);
        const j = i + 1 + (b % (cuts.length - 1 - i));
        const start = cuts[i] as number;
        const end = cuts[j] as number;
        const prefix = doc.slice(0, start);
        const region = doc.slice(start, end);
        const suffix = doc.slice(end);
        for (let k = 0; k <= region.length; k++) {
          const input = prefix + region.slice(0, k) + suffix;
          const r = heal(input, { ...NO_LINT, streamingRange: { from: start, to: start + k } });
          if (!r.source.endsWith(suffix) || !r.source.startsWith(prefix)) {
            throw new Error(`region heal touched outside text\n${explain(input, r.source)}`);
          }
          if (syntaxErrors(r.source).length > 0) throw new Error(explain(input, r.source));
        }
      }),
      { numRuns: Math.ceil(RUNS / 3) },
    );
  });

  it("9. streaming a block into a finished document leaves the rest as final mode healed it", () => {
    // An AI edit: a finished document, one top-level block deleted and written back in random
    // chunks. Lint on, with fixes on both sides of the block, so the settled text keeps its fixes.
    const lintDoc = documentArb.map(
      (d) =>
        `= Head\n\nSome **bold**, me@x.com and m/s$^2$.\n\n${d}\n\nMore ] text **x** here.\n\n#par(justify: true)[Ragged]\n\n# Tail\n\nend`,
    );
    fc.assert(
      fc.property(
        lintDoc.chain((doc) => {
          // Blocks of the generated part: the lint fixes stay on both sides.
          const first = doc.indexOf("\n\n", doc.indexOf("m/s$")) + 2;
          const last = doc.indexOf("More ] text");
          const all = blockStarts(doc);
          const starts = all.filter((at) => at >= first && at < last);
          if (starts.length === 0) return fc.constant(null);
          return fc.tuple(fc.nat(starts.length - 1), fc.nat(starts.length - 1)).chain(([a, b]) => {
            const from = starts[Math.min(a, b)] as number;
            // To the end of a block's text: the blank line after it stays outside the range.
            const next = all.find((at) => at > (starts[Math.max(a, b)] as number)) ?? last;
            const to = from + doc.slice(from, next).trimEnd().length;
            return chunksArb(doc.slice(from, to)).map((chunks) => ({ doc, from, to, chunks }));
          });
        }),
        (c) => {
          if (c === null) return;
          const { doc, from, to, chunks } = c;
          const final = heal(doc, { final: true });
          const prefix = final.source.slice(0, final.map.toSource(from));
          const suffix = final.source.slice(final.map.toSource(to));
          const h = createHealer();
          h.set(doc);
          h.finish();
          h.setStreamingRange({ from, to });
          let r = h.applyEdit({ from, to, insert: "" });
          let at = from;
          const check = (step: string) => {
            const where = `${step}\n${explain(h.input, r.source)}`;
            if (syntaxErrors(r.source).length > 0) throw new Error(`doesn't parse at ${where}`);
            if (!r.source.startsWith(prefix)) throw new Error(`the text before changed at ${where}`);
            if (!r.source.endsWith(suffix)) throw new Error(`the text after changed at ${where}`);
            expect(r.suffixOffset).toBe(r.source.length - suffix.length);
            const ref = heal(h.input, { streamingRange: h.streamingRange });
            expect(r.source, "incremental ≠ stateless").toBe(ref.source);
          };
          check("start");
          for (const chunk of chunks) {
            r = h.applyEdit({ from: at, to: at, insert: chunk });
            at += chunk.length;
            check(JSON.stringify(chunk));
          }
          expect(h.streamingRange).toEqual({ from, to });
          expect(h.finish().source).toBe(final.source);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("8. edits with lint on ≡ stateless healing, findings included", () => {
    // Lint findings are cached and shifted across edits (§5.2 resync); with a
    // settled handler they are recomputed instead. Both must match a fresh heal.
    const lintDoc = documentArb.map(
      (d) =>
        `# Head\n\nSome **bold** and me@x.com.\n\n${d}\n\n#par(leading: 1em)[x]\n\nMore ] text **x** here.\n\n# Tail\n\nend`,
    );
    const editArb = fc.record({
      at: fc.nat(),
      del: fc.nat({ max: 12 }),
      insert: fc.oneof(
        fc.constantFrom(
          "",
          "**b** ",
          "# H\n",
          " # H\n",
          "a ] b",
          "me@x.com ",
          "\n\n",
          "*",
          "[",
          "x",
          "#par(justify: true)[p]",
        ),
        fc.string({ maxLength: 6 }),
      ),
    });
    const handler = { name: "noop", phase: "settled" as const, run: () => [] };
    fc.assert(
      fc.property(
        lintDoc,
        fc.array(editArb, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        (doc, edits, withHandler) => {
          const opts = withHandler ? { handlers: [handler] } : {};
          const healer = createHealer(opts);
          healer.set(doc);
          let text = doc;
          for (const e of edits) {
            const from = e.at % (text.length + 1);
            const to = Math.min(from + e.del, text.length);
            text = text.slice(0, from) + e.insert + text.slice(to);
            const inc = healer.applyEdit({ from, to, insert: e.insert });
            const ref = heal(text, opts);
            expect(inc.source, JSON.stringify({ e, text })).toBe(ref.source);
            expect(inc.findings).toEqual(ref.findings);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
