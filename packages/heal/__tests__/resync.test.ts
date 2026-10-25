// Resynchronization after edits (PLAN.md §5.2): re-recognition stops at the
// first matching root checkpoint past the edit, and the spliced state must equal
// recognizing the edited text from scratch.

import type { TextEdit } from "@typstream/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fullState, type State, updateState } from "../src/heal";
import { BLOCK_ATOMS, documentArb, INLINE_ATOMS } from "./support/generators";

const RUNS = Number(process.env.HEAL_PROPERTY_RUNS ?? 150);

const makeDoc = (size: number): string => {
  const atoms = [...BLOCK_ATOMS, ...INLINE_ATOMS];
  let out = "";
  for (let i = 0; out.length < size; i++) out += `${atoms[(i * 7) % atoms.length]}\n\n`;
  return out.slice(0, size);
};

const edit = (text: string, e: TextEdit): string => text.slice(0, e.from) + e.insert + text.slice(e.to);

/** Applies `e` to a state of `text` and checks it against a fresh recognition. */
const check = (state: State, text: string, e: TextEdit) => {
  const next = edit(text, e);
  const update = updateState(state, next, e, {});
  const ref = fullState(next, {});
  expect(state.checkpoints).toEqual(ref.checkpoints);
  expect(state.errors).toEqual(ref.errors);
  expect(state.events).toEqual(ref.events);
  expect(state.modes).toEqual(ref.modes);
  expect(state.requirements).toEqual(ref.requirements);
  expect(state.lastTokenStart).toBe(ref.lastTokenStart);
  return { next, update };
};

describe("resync after an edit", () => {
  it("re-recognizes only the edited block of a 100 KB document", () => {
    const doc = makeDoc(100_000);
    // One-letter edits all over the document: each must resync within a few
    // blocks. (Deleting a `"` or splitting a raw fence can change the rest of the document.)
    for (let at = 37; at < doc.length; at += 4_999) {
      const letter = doc.slice(at).search(/[a-z]/) + at;
      for (const e of [
        { from: letter, to: letter, insert: "x" },
        { from: letter, to: letter + 1, insert: "" },
      ]) {
        const state = fullState(doc, {});
        const { update } = check(state, doc, e);
        if (update.to === null) throw new Error(`no resync for ${JSON.stringify(e)}`);
        expect(update.to - update.from).toBeLessThan(1_000);
      }
    }
  });

  it("shifts the reused state by the edit's length change", () => {
    const doc = makeDoc(20_000);
    let text = doc;
    const state = fullState(text, {});
    for (const e of [
      { from: 5_000, to: 5_010, insert: "" },
      { from: 9_000, to: 9_000, insert: "more *text* and $x$ math\n\n= Heading\n\n" },
      { from: 100, to: 120, insert: "ab" },
    ]) {
      const { next, update } = check(state, text, e);
      expect(update.to).not.toBeNull();
      text = next;
    }
  });

  it("parses to the end when the edit changes what follows", () => {
    for (const insert of ["/*", "#box[", "```\n", "["]) {
      const doc = makeDoc(5_000);
      const at = doc.indexOf("\n\n", 2_000) + 2;
      const { update } = check(fullState(doc, {}), doc, { from: at, to: at, insert });
      expect(update.to).toBeNull();
    }
  });

  // Edits that change whether a position before them is a checkpoint.
  it.each([
    ["#\n*", { from: 3, to: 3, insert: "/*" }],
    ["#\n*\n\nx", { from: 3, to: 3, insert: "/" }],
  ])("%j + %j", (text, e) => {
    check(fullState(text, {}), text, e);
  });

  it("random edits ≡ fresh recognition", () => {
    const editArb = fc.record({
      at: fc.nat(),
      del: fc.nat({ max: 12 }),
      insert: fc.oneof(
        fc.constantFrom("", "*", "[", "]", "$", "#f(", "\n\n", "\n", "x", "`", '"', "= ", "/*", "*/", "  ", "#"),
        fc.string({ maxLength: 6 }),
      ),
    });
    fc.assert(
      fc.property(
        fc.array(documentArb, { minLength: 1, maxLength: 4 }),
        fc.array(editArb, { minLength: 1, maxLength: 8 }),
        (docs, edits) => {
          let text = docs.join("\n\n");
          const state = fullState(text, {});
          for (const e of edits) {
            const from = Math.min(e.at, text.length);
            const to = Math.min(from + e.del, text.length);
            text = check(state, text, { from, to, insert: e.insert }).next;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
