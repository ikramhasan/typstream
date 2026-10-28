// Streaming edits (#34): the `<edit>` parser, quote matching, and the session
// that applies an answer's edits to a document as it streams, over recorded
// model documents (corpus/llm).
import { applyEdit, type Range } from "@typstream/core";
import { ALL_SETS, loadCorpus, synthesizeStream } from "@typstream/corpus";
import { blockStarts } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import {
  blockRange,
  createEditSession,
  type EditSession,
  type EditSessionState,
  editFeedback,
  editPrompt,
  findQuote,
  parseEdits,
  selectionRequest,
} from "../src";

const documents = loadCorpus({ sets: ALL_SETS })
  .filter((e) => e.set === "llm" && e.name.startsWith("kit-v4-sonnet-"))
  .map((e) => ({ name: e.name, text: e.source }));

/** The text of each top-level block, as `blockRange` gives it. */
const blocksOf = (text: string): Range[] => blockStarts(text).map((from) => blockRange(text, { from, to: from }));

const edit = (quote: string, text: string) => `<edit>\n<old>\n${quote}\n</old>\n<new>\n${text}\n</new>\n</edit>\n`;

/** Feeds `answer` to the session in synthesized chunks; `check` sees every state. */
const stream = (
  session: EditSession,
  answer: string,
  options: { seed?: number; check?: (s: EditSessionState) => void; stopAt?: number } = {},
) => {
  let sent = "";
  const chunks = synthesizeStream(answer, { seed: options.seed ?? 1 });
  for (const [i, chunk] of chunks.entries()) {
    if (options.stopAt === i) return session.abort();
    sent += chunk.text;
    session.update(sent, i === chunks.length - 1);
    options.check?.(session.getState());
  }
};

describe("parseEdits", () => {
  const answer = `Made question 2 harder and fixed a typo.\n${edit("#question[What is $3 + 4$?]", "#question[What is $37 + 48$?]")}${edit("Simplfy", "Simplify")}Anything else?`;

  it("reads edits and the message around them", () => {
    expect(parseEdits(answer, true)).toEqual({
      edits: [
        { quote: "#question[What is $3 + 4$?]", quoteDone: true, text: "#question[What is $37 + 48$?]", done: true },
        { quote: "Simplfy", quoteDone: true, text: "Simplify", done: true },
      ],
      message: "Made question 2 harder and fixed a typo.\n\nAnything else?",
    });
  });

  it("only grows as the answer streams, and never shows part of a tag", () => {
    const final = parseEdits(answer, true);
    let previous = parseEdits("");
    for (let n = 0; n <= answer.length; n++) {
      const parsed = parseEdits(answer.slice(0, n));
      expect(parsed.message).not.toMatch(/<\/?[a-z]*$/);
      expect(final.message.startsWith(parsed.message.trimEnd()) || final.message.includes(parsed.message)).toBe(true);
      parsed.edits.forEach((op, i) => {
        const done = final.edits[i];
        expect(done?.quote.startsWith(op.quote)).toBe(true);
        expect(done?.text.startsWith(op.text)).toBe(true);
        const before = previous.edits[i];
        if (before) {
          expect(op.quote.startsWith(before.quote)).toBe(true);
          expect(op.quoteDone >= before.quoteDone && op.done >= before.done).toBe(true);
        }
      });
      expect(parsed.edits.length).toBeGreaterThanOrEqual(previous.edits.length);
      previous = parsed;
    }
  });

  it("forgives a fence, a missing </edit>, and Typst labels inside the text", () => {
    const parsed = parseEdits(
      "<edit><old>\n```typst\n= Intro\n```\n</old><new>\n```typst\n= Intro <new>\n```\n</new>\nDone.",
      true,
    );
    expect(parsed.edits).toEqual([{ quote: "= Intro", quoteDone: true, text: "= Intro <new>", done: true }]);
    expect(parsed.message).toBe("Done.");
  });

  it("marks an edit written another way as malformed, and an unfinished one as not done", () => {
    expect(parseEdits("<edit><replace>x</replace></edit>", true).edits[0]?.malformed).toBe(true);
    expect(parseEdits("<edit><old>a</old><new>b", true).edits[0]).toEqual({
      quote: "a",
      quoteDone: true,
      text: "b",
      done: false,
    });
  });
});

describe("findQuote", () => {
  const text = "= Fractions\n\n#question[\n  Simplify $12/18$.\n]\n\n#question[Add $1/2$ and $1/3$.]";

  it("matches exactly, ignoring the quote's own surrounding whitespace", () => {
    const { ranges, exact } = findQuote(text, "\n#question[Add $1/2$ and $1/3$.]\n");
    expect(exact).toBe(true);
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(["#question[Add $1/2$ and $1/3$.]"]);
  });

  it("evens out whitespace when nothing matches exactly", () => {
    const { ranges, exact } = findQuote(text, "#question[ Simplify $12/18$. ]");
    expect(exact).toBe(false);
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(["#question[\n  Simplify $12/18$.\n]"]);
  });

  it("reports a quote found twice, and finds nothing for an empty one", () => {
    expect(findQuote(text, "#question[").ranges).toHaveLength(2);
    expect(findQuote(text, "  ").ranges).toEqual([]);
    expect(findQuote(text, "Subtract").ranges).toEqual([]);
  });
});

describe("blockRange", () => {
  it("widens a range to its whole blocks, without the blank line after them", () => {
    const text = "= A\n\nOne\ntwo\n\n#question[\n  x\n\n  y\n]\n\nEnd\n";
    const at = (s: string) => text.indexOf(s);
    expect(blockRange(text, { from: at("two"), to: at("two") + 2 })).toEqual({ from: at("One"), to: at("two") + 3 });
    expect(blockRange(text, { from: at("y"), to: at("y") })).toEqual({ from: at("#question"), to: at("]") + 1 });
    expect(blockRange(text, { from: at("two"), to: at("x") })).toEqual({ from: at("One"), to: at("]") + 1 });
  });
});

describe("an edit session", () => {
  it("has documents to edit", () => expect(documents.length).toBeGreaterThan(3));

  it.each(documents)("$name: rewriting each block streams it in, leaving the rest as it was", ({ text }) => {
    const blocks = blocksOf(text);
    for (const [i, block] of blocks.entries()) {
      const quote = text.slice(block.from, block.to);
      const other = blocks[(i + 1) % blocks.length] as Range;
      const replacement = `${text.slice(other.from, other.to)}\nRewritten.`;
      const expected = applyEdit(text, { ...block, insert: replacement });
      const session = createEditSession(text);
      let streamed = false;
      stream(session, `Rewrote it.\n${edit(quote, replacement)}`, {
        seed: i,
        check: (s) => {
          // What lies around the block never changes.
          expect(s.text.slice(0, block.from)).toBe(text.slice(0, block.from));
          expect(s.text.endsWith(text.slice(block.to))).toBe(true);
          if (s.streamingRange) {
            streamed = true;
            expect(s.streamingRange.from).toBe(block.from);
            expect(s.text.length - s.streamingRange.to).toBe(text.length - block.to);
            expect(s.streaming).toBe(true);
          }
        },
      });
      const s = session.getState();
      expect(s.text).toBe(expected);
      expect(s.edits).toEqual([
        { status: "applied", quote, range: { from: block.from, to: block.from + replacement.length }, loose: false },
      ]);
      expect(s.phase).toBe("review");
      expect(s.message).toBe("Rewrote it.");
      expect(streamed).toBe(true);
      session.undo();
      expect(session.getState().text).toBe(text);
      expect(session.getState().phase).toBe("undone");
    }
  });

  it.each(documents)("$name: a stream stopped halfway puts the block back", ({ text }) => {
    const blocks = blocksOf(text);
    for (const [i, block] of blocks.entries()) {
      const session = createEditSession(text);
      const answer = edit(text.slice(block.from, block.to), "#question[A new question, written slowly.]");
      stream(session, answer, { seed: i, stopAt: 5 + (i % 7) });
      const s = session.getState();
      expect(s.text).toBe(text);
      expect(s.streamingRange).toBeNull();
      expect(s.edits.every((e) => e.status === "failed" && e.error === "incomplete")).toBe(true);
    }
  });

  it("keeps the old text while the new text starts like it", () => {
    const text = "= Quiz\n\n#question[What is $3 + 4$?]\n\nEnd.";
    const session = createEditSession(text);
    const answer = edit("#question[What is $3 + 4$?]", "#question[What is $3 + 4 + 5$?]");
    const shown: string[] = [];
    stream(session, answer, { check: (s) => shown.push(s.text) });
    const before = shown.filter((t) => t === text).length;
    const first = shown.findIndex((t) => t !== text);
    expect(before).toBeGreaterThan(3);
    expect(shown[first]).toContain("#question[What is $3 + 4 +");
    expect(session.getState().text).toBe("= Quiz\n\n#question[What is $3 + 4 + 5$?]\n\nEnd.");
  });

  it("reports what the quote matches while it streams", () => {
    const text = "= Quiz\n\n#question[What is $3 + 4$?]\n\n#question[Name a prime.]";
    const session = createEditSession(text);
    session.update("<edit><old>#question[Wh");
    expect(session.getState().edits[0]).toMatchObject({ status: "quoting", range: { from: 8, to: 20 } });
    session.update("<edit><old>#question[");
    expect(session.getState().edits[0]?.range).toBeNull();
  });

  it("replaces a quote inside a block once its new text is complete", () => {
    const text = "#question[\n  Simplfy $12/18$.\n  #answer[$2/3$]\n]\n\nEnd.";
    const session = createEditSession(text);
    stream(session, edit("Simplfy $12/18$.", "Simplify $12/18$ fully."), {
      check: (s) => {
        expect(s.streamingRange).toBeNull();
        if (s.phase === "streaming") expect([text, s.text]).toContain(s.text);
      },
    });
    expect(session.getState().text).toBe("#question[\n  Simplify $12/18$ fully.\n  #answer[$2/3$]\n]\n\nEnd.");
  });

  it("streams a quote that ends before its block's closing bracket, leaving the bracket out meanwhile", () => {
    const text = "#question[\n  What is $3 + 4$?\n]\n\nEnd.";
    const session = createEditSession(text);
    let streamed = false;
    stream(session, edit("What is $3 + 4$?", "What is $37 + 48$? Show your working, then check it another way."), {
      check: (s) => {
        if (s.streamingRange) streamed = true;
        expect(s.text.endsWith("\n\nEnd.")).toBe(true);
      },
    });
    expect(streamed).toBe(true);
    expect(session.getState().text).toBe(
      "#question[\n  What is $37 + 48$? Show your working, then check it another way.\n]\n\nEnd.",
    );
  });

  it("deletes whole blocks with the blank line between them, and adds blocks after a quoted one", () => {
    const text = "= A\n\nOne.\n\nTwo.\n\nThree.";
    const deleted = createEditSession(text);
    stream(deleted, `${edit("Two.", "")}${edit("Three.", "")}`);
    expect(deleted.getState().text).toBe("= A\n\nOne.");
    deleted.undo();
    expect(deleted.getState().text).toBe(text);

    const added = createEditSession(text);
    stream(added, edit("One.", "One.\n\nOne and a half."));
    expect(added.getState().text).toBe("= A\n\nOne.\n\nOne and a half.\n\nTwo.\n\nThree.");
  });

  it("applies the edits it can and reports the others, for the model to try again", () => {
    const text = "= A\n\nOne.\n\nTwo.\n\nTwo.\n\nThree.";
    const session = createEditSession(text);
    stream(
      session,
      `${edit("One.", "1.")}${edit("Four.", "4.")}${edit("Two.", "2.")}${edit("= A\n\nOne.", "= B")}${edit("Three.", "3.")}`,
    );
    const s = session.getState();
    expect(s.text).toBe("= A\n\n1.\n\nTwo.\n\nTwo.\n\n3.");
    expect(s.edits.map((e) => e.error ?? e.status)).toEqual([
      "applied",
      "not-found",
      "ambiguous",
      "overlap",
      "applied",
    ]);
    expect(editFeedback(s.edits)).toMatchInlineSnapshot(`
      "3 of your edits weren't applied:
      - Edit 2: its <old> text isn't in the document.
      - Edit 3: its <old> text appears more than once in the document; quote more of it.
      - Edit 4: it changes text that an earlier edit of yours changed.
      The others were. Write the ones that failed again, quoting the document as it is now."
    `);
    expect(editFeedback(s.edits.slice(0, 1))).toBeNull();
  });

  it("matches a quote with whitespace evened out", () => {
    const text = "#question[\n  Simplify $12/18$.\n]\n\nEnd.";
    const session = createEditSession(text);
    stream(session, edit("#question[ Simplify $12/18$. ]", "#question[Simplify $15/25$.]"));
    expect(session.getState().text).toBe("#question[Simplify $15/25$.]\n\nEnd.");
    expect(session.getState().edits[0]?.loose).toBe(true);
  });

  it("moves with the teacher's edits, and stops where the teacher edits what it writes", () => {
    const text = "= A\n\nOne.\n\nTwo.";
    const answer = edit("Two.", "Two, rewritten at some length so that it streams in several chunks.");

    const before = createEditSession(text);
    stream(before, answer, {
      check: (s) => {
        if (s.streamingRange && !s.text.startsWith("= AB")) before.userEdit({ from: 3, to: 3, insert: "B" });
      },
    });
    expect(before.getState().text).toBe(
      "= AB\n\nOne.\n\nTwo, rewritten at some length so that it streams in several chunks.",
    );

    const inside = createEditSession(text);
    let edited = false;
    stream(inside, answer, {
      check: (s) => {
        if (s.streamingRange && !edited) {
          edited = true;
          inside.userEdit({ from: s.streamingRange.from + 1, to: s.streamingRange.from + 1, insert: "My " });
        }
      },
    });
    const s = inside.getState();
    expect(s.edits[0]).toMatchObject({ status: "failed", error: "conflict" });
    expect(s.text.startsWith("= A\n\nOne.\n\nTMy w")).toBe(true);
    expect(s.streamingRange).toBeNull();

    const quoted = createEditSession(text);
    quoted.update("<edit><old>Tw");
    quoted.userEdit({ from: text.indexOf("Two"), to: text.indexOf("Two") + 3, insert: "2" });
    quoted.update(answer, true);
    expect(quoted.getState().edits[0]).toMatchObject({ status: "failed", error: "conflict" });
  });

  it("writes a selection edit over the selection's whole blocks", () => {
    const text = "= A\n\n#question[\n  Simplify $12/18$.\n]\n\nEnd.";
    const selection = { from: text.indexOf("12/18"), to: text.indexOf("12/18") + 5 };
    const range = blockRange(text, selection);
    expect(selectionRequest(text, range, "make it harder")).toContain(
      "<selection>#question[\n  Simplify $12/18$.\n]</selection>",
    );
    const session = createEditSession(text);
    const replacement = "```typst\n#question[\n  Simplify $144/216$.\n]\n```";
    let streamed = false;
    for (let n = 1; n <= replacement.length; n++) {
      session.write(selection, replacement.slice(0, n), n === replacement.length);
      const s = session.getState();
      if (s.streamingRange) streamed = true;
      expect(s.text).not.toContain("```");
    }
    expect(streamed).toBe(true);
    expect(session.getState().text).toBe("= A\n\n#question[\n  Simplify $144/216$.\n]\n\nEnd.");
  });

  it("keeps or undoes, once", () => {
    const text = "One.\n\nTwo.";
    const kept = createEditSession(text);
    stream(kept, edit("Two.", "2."));
    kept.keep();
    kept.undo();
    expect(kept.getState()).toMatchObject({ text: "One.\n\n2.", phase: "kept" });
  });

  it("returns the same state until it changes, and tells its listeners", () => {
    const session = createEditSession("One.");
    const seen: EditSessionState[] = [];
    const stop = session.subscribe((s) => seen.push(s));
    expect(session.getState()).toBe(session.getState());
    session.update("<edit><old>One.</old><new>1.</new></edit>", true);
    stop();
    session.keep();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toBe("1.");
  });
});

describe("editPrompt", () => {
  it("shows the format in an example the parser reads", () => {
    const example = editPrompt().slice(editPrompt().indexOf("For example:"));
    expect(parseEdits(example, true).edits).toHaveLength(1);
  });
});
