// The prompt kit (#24): the system prompt holds the whole catalogue, the rules and the examples,
// and the hand-written rules can't drift from the package: every edu function they call exists
// and takes the arguments they name. (The catalogue itself is generated from the doc comments;
// package.test.ts checks that it covers every public name.)
import type { TypstreamPlugin } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, edu, eduCatalogue, eduExamples, eduPromptRules, typstPromptRules } from "../src/index";

/** Typst's own functions the rules mention, and `f`, a stand-in for any function. */
const TYPST = new Set(["columns", "grid", "table", "figure", "image", "text", "import", "link", "v", "h", "f"]);

/** The parameter names of a catalogue signature, `..options` as `options`. */
const params = (signature: string): Set<string> => {
  const inner = signature.slice(signature.indexOf("(") + 1, -1);
  const names = new Set<string>();
  let depth = 0;
  let part = "";
  for (const c of `${inner},`) {
    if ("([".includes(c)) depth++;
    else if (")]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      const name = /^\s*(?:\.\.)?([\w-]+)/.exec(part)?.[1];
      if (name) names.add(name);
      part = "";
    } else part += c;
  }
  return names;
};

/** Calls in a piece of Typst: `#name(` or `name.with(`, with the named arguments at their top level. */
const calls = (code: string): { name: string; named: string[] }[] => {
  const out: { name: string; named: string[] }[] = [];
  for (const m of code.matchAll(/([a-z][\w-]*)(?:\.with)?\(/g)) {
    let depth = 0;
    const open = (m.index ?? 0) + m[0].length - 1;
    const named: string[] = [];
    for (let at = open; at < code.length; at++) {
      const c = code[at] ?? "";
      if ("([".includes(c)) depth++;
      else if (")]".includes(c) && --depth === 0) break;
      else if (c === '"') at = code.indexOf('"', at + 1);
      // An argument starts after the call's `(` or a `,` at its top level.
      if (depth === 1 && (c === "," || at === open)) {
        const key = /^[,(]\s*([a-z][\w-]*):/.exec(code.slice(at))?.[1];
        if (key) named.push(key);
      }
    }
    out.push({ name: m[1] ?? "", named });
  }
  return out;
};

describe("prompt kit", () => {
  const prompt = buildSystemPrompt([edu]);

  it("holds every catalogue entry, rule and example", () => {
    for (const doc of eduCatalogue) {
      expect(prompt).toContain(doc.signature);
      expect(prompt).toContain(doc.description);
      if (doc.example) expect(prompt).toContain(doc.example);
    }
    for (const rule of [...typstPromptRules, ...eduPromptRules]) expect(prompt).toContain(rule);
    for (const e of eduExamples) expect(prompt).toContain(e.output.trim());
  });

  it("is deterministic, so it caches", () => {
    expect(buildSystemPrompt([edu])).toBe(prompt);
  });

  it("adds other plugins' rules and leaves out examples when asked", () => {
    const other: TypstreamPlugin = { key: "acme", prompt: { rules: ["Use only acme's colours."] } };
    const both = buildSystemPrompt([edu, other], { examples: false });
    expect(both).toContain("## Rules (acme)\n- Use only acme's colours.");
    expect(both).not.toContain("<example>");
  });

  it("names only edu functions that exist, with arguments they take", () => {
    const catalogue = new Map(eduCatalogue.map((d) => [d.name, params(d.signature)]));
    const code = [...typstPromptRules, ...eduPromptRules].flatMap((r) =>
      [...r.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ""),
    );
    expect(code.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const span of code) {
      for (const { name, named } of calls(span)) {
        const known = catalogue.get(name);
        if (!known) {
          if (!TYPST.has(name)) problems.push(`${span}: no function ${name}`);
          continue;
        }
        for (const key of named) if (!known.has(key)) problems.push(`${span}: ${name} takes no ${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("reads parameters off signatures", () => {
    expect([...params("mcq(..options, answer: none, columns: auto)")]).toEqual(["options", "answer", "columns"]);
    expect(calls("#mcq([a], [b], answer: 2)")).toEqual([{ name: "mcq", named: ["answer"] }]);
    expect(calls("#show: worksheet.with(title: [x], grade: [y])")).toEqual([
      { name: "worksheet", named: ["title", "grade"] },
    ]);
  });
});
