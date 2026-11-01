/// <reference lib="dom" />
// Editing in <TypstPlateEditor> with real key presses (Playwright's): each becomes an edit of the Typst, typed text
// shows before the compile does, and the document shown afterwards is the HTML target's of the new source.

import { cleanup, render } from "@testing-library/react";
import type { Engine } from "@typstream/engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { TypstPlateEditor } from "../../src/index";
import { startEngine } from "../support/engine";

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());
afterEach(cleanup);

const DOC = `= Fractions

Add the fractions *carefully* and simplify.

- First item
- Second item
`;

const until = async (what: string, ok: () => boolean, ms = 20_000) => {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** The editor on `source`, and the source as it changes. */
const open = async (source = DOC) => {
  const box = document.createElement("div");
  box.style.width = "700px";
  document.body.append(box);
  const state = { source };
  render(
    <TypstPlateEditor
      value={source}
      engine={engine}
      onChange={(s) => {
        state.source = s;
      }}
      floatingToolbar={false}
    />,
    { container: box },
  );
  const flow = () => box.querySelector(".typstream-plate-flow") as HTMLElement;
  await until("the editor", () => !!flow()?.textContent?.includes("simplify"));
  /** Waits for the value read from the compile of the source as it is. */
  const settled = async (text: string) => until(`"${text}" shown`, () => !!flow().textContent?.includes(text));
  return { box, state, flow, settled };
};

/** Puts the caret in the editor at `offset` into the first text node holding `text` (DOM selection, as a click does). */
const caret = (flow: HTMLElement, text: string, offset: number, end?: number) => {
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n as Text).data.indexOf(text);
    if (at < 0) continue;
    flow.focus();
    const range = document.createRange();
    range.setStart(n, at + offset);
    range.setEnd(n, at + (end ?? offset));
    const sel = document.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  throw new Error(`no text "${text}"`);
};

/** Slate reads the DOM selection at most every 100 ms. */
const tick = () => new Promise((r) => setTimeout(r, 150));

describe("TypstPlateEditor", () => {
  it("types into the Typst, showing the text at once", async () => {
    const { state, flow, settled } = await open();
    caret(flow(), "simplify.", 9);
    await tick();
    await userEvent.keyboard(" Done");
    // Before the compile: Slate put it in the text.
    expect(flow().textContent).toContain("simplify. Done");
    expect(state.source).toContain("and simplify. Done\n");
    await settled("simplify. Done");
    await userEvent.keyboard("!");
    await until("the next key", () => state.source.includes("simplify. Done!"));
  });

  it("escapes what Typst would read as markup", async () => {
    const { state, flow, settled } = await open();
    caret(flow(), "Add", 3);
    await tick();
    await userEvent.keyboard("*#$");
    await until("the edit", () => state.source.includes("Add\\*\\#\\$ the"));
    await settled("Add*#$ the");
  });

  it("splits a paragraph with Enter and joins it again with Backspace", async () => {
    const { state, flow, settled } = await open();
    caret(flow(), "and simplify", 0);
    await tick();
    await userEvent.keyboard("{Enter}");
    await until("the break", () => state.source.includes("*carefully*\n\nand simplify."));
    await settled("and simplify.");
    await until("two paragraphs", () =>
      [...flow().querySelectorAll("p")].some((p) => p.textContent?.trim() === "and simplify."),
    );
    caret(flow(), "and simplify", 0);
    await tick();
    await userEvent.keyboard("{Backspace}");
    await until("the join", () => state.source.includes("*carefully*and simplify."));
  });

  it("adds a list item with Enter", async () => {
    const { state, flow } = await open();
    caret(flow(), "First item", 10);
    await tick();
    await userEvent.keyboard("{Enter}");
    await until("the item", () => state.source.includes("- First item\n- \n- Second item"));
  });

  it("makes text bold with ⌘B / Ctrl+B and plain again", async () => {
    const { state, flow, settled } = await open();
    caret(flow(), "fractions", 0, 9);
    await tick();
    await userEvent.keyboard("{Control>}b{/Control}");
    await until("the mark", () => state.source.includes("Add the *fractions* "));
    await settled("fractions");
    await until("strong", () => [...flow().querySelectorAll("strong")].some((s) => s.textContent === "fractions"));
    caret(flow(), "fractions", 2);
    await tick();
    await userEvent.keyboard("{Control>}b{/Control}");
    await until("unmarked", () => state.source.includes("Add the fractions *carefully*"));
  });

  it("turns a paragraph into a heading from the toolbar, and undoes it", async () => {
    const { box, state, flow, settled } = await open();
    caret(flow(), "Add the", 2);
    await tick();
    const select = box.querySelector("select[aria-label='Block type']") as HTMLSelectElement;
    await until("the block type", () => select.value === "paragraph");
    await userEvent.selectOptions(select, "h2");
    await until("the heading", () => state.source.includes("== Add the fractions"));
    await settled("Add the");
    await until("an h3", () => [...flow().querySelectorAll("h3")].some((h) => h.textContent?.startsWith("Add the")));
    caret(flow(), "Add the", 2);
    await userEvent.keyboard("{Control>}z{/Control}");
    await until("undone", () => state.source === DOC);
  });

  it("never edits the code that writes text the document shows", async () => {
    const source = '#let who = "Ada"\n\nAdd the simplify. Hello #who, and more.\n';
    const { state, flow } = await open(source);
    // In "Ada" (no source of its own, beside the text around it): typing goes before it, deleting does nothing.
    caret(flow(), "Ada", 1);
    await tick();
    await userEvent.keyboard("{Backspace}");
    await tick();
    expect(state.source).toBe(source);
    await userEvent.keyboard("x");
    await until("the edit", () => state.source.includes("Hello x#who, and more."));
    expect(state.source).toContain('#let who = "Ada"');
  });

  it("types after text code shows without going on with the code", async () => {
    const source = '#let who = "Ada"\n\nAdd the simplify. Hello #who, and #who is.\n';
    const { state, flow, settled } = await open(source);
    // Right after "Ada": the start of ", and".
    caret(flow(), "Ada, and", 3);
    await tick();
    await userEvent.keyboard("x");
    await until("the edit", () => state.source.includes("Hello #who;x, and"));
    await settled("Adax, and");
    // Before the space after the second: the space's edge is after the code too.
    caret(flow(), "Ada is", 3);
    await tick();
    await userEvent.keyboard("y");
    await until("the second edit", () => state.source.includes("#who;y is."));
    await settled("Aday is");
  });

  it("deletes a word across marks, keeping the markup", async () => {
    const { state, flow } = await open();
    // From inside "fractions" to inside "carefully": the text goes, `*…*` stays around what's left of it.
    caret(flow(), "fractions", 4);
    const walker = document.createTreeWalker(flow(), NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if ((n as Text).data.includes("carefully")) target = n as Text;
    const sel = document.getSelection() as Selection;
    sel.extend(target as Text, 4);
    await tick();
    await userEvent.keyboard("{Backspace}");
    await until("the deletion", () => state.source.includes("Add the frac*fully* and"));
  });
});
