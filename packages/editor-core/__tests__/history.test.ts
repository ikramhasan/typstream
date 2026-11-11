import { describe, expect, it } from "vitest";
import { History } from "../src/index";

/** Types `text` a character at a time from `at` in `doc`, `gap` ms apart, starting at time `t`. */
const type = (h: History, doc: string, at: number, text: string, t: number, gap = 80): { doc: string; t: number } => {
  for (const c of text) {
    const next = doc.slice(0, at) + c + doc.slice(at);
    h.record(doc, next, { anchor: at, head: at }, { anchor: at + 1, head: at + 1 }, true, t);
    doc = next;
    at++;
    t += gap;
  }
  return { doc, t };
};

/** Presses Backspace `n` times at `at`. */
const erase = (h: History, doc: string, at: number, n: number, t: number, gap = 80): { doc: string; t: number } => {
  for (let i = 0; i < n; i++) {
    const next = doc.slice(0, at - 1) + doc.slice(at);
    h.record(doc, next, { anchor: at, head: at }, { anchor: at - 1, head: at - 1 }, true, t);
    doc = next;
    at--;
    t += gap;
  }
  return { doc, t };
};

/** The texts each undo goes back to. */
const undos = (h: History, doc: string): string[] => {
  const out: string[] = [];
  for (let back = h.undo(doc); back; back = h.undo(doc)) {
    doc = back.text;
    out.push(doc);
  }
  return out;
};

describe("history", () => {
  it("a word typed in one go is one step", () => {
    const h = new History();
    const { doc } = type(h, "", 0, "Hello", 0);
    expect(undos(h, doc)).toEqual([""]);
  });

  it("a pause between words starts a step: each word goes with the space before it", () => {
    const h = new History();
    let s = type(h, "Start", 5, " one", 0);
    s = type(h, s.doc, s.doc.length, " two", s.t + 400);
    s = type(h, s.doc, s.doc.length, " three", s.t + 400);
    expect(undos(h, s.doc)).toEqual(["Start one two", "Start one", "Start"]);
  });

  it("a pause inside a word doesn't, nor one between a space and its word", () => {
    const h = new History();
    let s = type(h, "", 0, "one", 0);
    s = type(h, s.doc, 3, " ", s.t + 500);
    s = type(h, s.doc, 4, "tw", s.t + 500);
    s = type(h, s.doc, 6, "o", s.t + 500);
    expect(undos(h, s.doc)).toEqual(["one", ""]);
  });

  it("words typed without a pause are steps of a few words", () => {
    const h = new History();
    const { doc } = type(h, "", 0, "the quick brown fox jumps over the lazy dog and runs away again", 0, 100);
    const steps = undos(h, doc);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.length).toBeLessThan(6);
    // Every step ends at a word's end.
    for (const text of steps.slice(0, -1)) expect(doc.slice(text.length)).toMatch(/^ /);
    expect(steps[steps.length - 1]).toBe("");
  });

  it("a long pause ends the step anywhere", () => {
    const h = new History();
    let s = type(h, "", 0, "ab", 0);
    s = type(h, s.doc, 2, "cd", s.t + 1500);
    expect(undos(h, s.doc)).toEqual(["ab", ""]);
  });

  it("typing somewhere else is another step, however fast", () => {
    const h = new History();
    let s = type(h, "one two", 3, "X", 0);
    s = type(h, s.doc, 8, "Y", s.t);
    expect(s.doc).toBe("oneX twoY");
    expect(undos(h, s.doc)).toEqual(["oneX two", "one two"]);
  });

  it("the caret moved away and back ends the step too", () => {
    const h = new History();
    const a = type(h, "", 0, "ab", 0);
    // Typed at the end again, but over a selection the caret made in between.
    h.record("ab", "abc", { anchor: 0, head: 2 }, { anchor: 3, head: 3 }, true, a.t);
    expect(undos(h, "abc")).toEqual(["ab", ""]);
  });

  it("a run of Backspaces is one step, apart from the typing before it", () => {
    const h = new History();
    let s = type(h, "", 0, "Hello", 0);
    s = erase(h, s.doc, 5, 3, s.t);
    expect(s.doc).toBe("He");
    expect(undos(h, s.doc)).toEqual(["Hello", ""]);
  });

  it("typing after Backspaces is a step of its own", () => {
    const h = new History();
    let s = erase(h, "Hello", 5, 2, 0);
    s = type(h, s.doc, 3, "p!", s.t);
    expect(undos(h, s.doc)).toEqual(["Hel", "Hello"]);
  });

  it("a command's change never joins", () => {
    const h = new History();
    const s = type(h, "", 0, "ab", 0);
    h.record("ab", "*ab*", { anchor: 0, head: 2 }, { anchor: 1, head: 3 }, false, s.t);
    const t = type(h, "*ab*", 3, "c", s.t + 10);
    expect(undos(h, t.doc)).toEqual(["*ab*", "ab", ""]);
  });

  it("redo goes forward again, and a new change forgets what was undone", () => {
    const h = new History();
    const s = type(h, "", 0, "ab", 0);
    expect(h.undo(s.doc)?.text).toBe("");
    expect(h.redo("")?.text).toBe("ab");
    expect(h.undo("ab")?.text).toBe("");
    type(h, "", 0, "x", 5000);
    expect(h.canRedo).toBe(false);
  });
});
