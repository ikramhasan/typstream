/// <reference lib="dom" />
// <TypstEditor> in each browser on the real engine worker: a worksheet opens as rich text with
// edu's components compiled, the toolbars' commands come out as minimal edits of the source,
// the slash menu inserts, and an edit from outside keeps the blocks it didn't touch.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { TextEdit } from "@typstream/core";
import { applyEdit } from "@typstream/core";
import { edu } from "@typstream/edu";
import { createEngine, type Engine, fromWorker } from "@typstream/engine";
import { TypstreamProvider } from "@typstream/react";
import { createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TypstEditor, type TypstEditorHandle } from "../../src/index";

const SOURCE = `= Fractions

Add *same* denominators.

#question(points: 2)[What is $1/4 + 2/4$?]

- one
- two
`;

let engine: Engine;
beforeAll(async () => {
  engine = createEngine({
    spawn: fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" })),
    spare: false,
  });
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());
afterEach(cleanup);

const open = (source = SOURCE) => {
  const ref = createRef<TypstEditorHandle>();
  const edits: TextEdit[] = [];
  let current = source;
  const view = render(
    <TypstreamProvider engine={engine} plugins={[edu]}>
      <TypstEditor
        ref={ref}
        defaultSource={source}
        onChange={(next, edit) => {
          expect(applyEdit(current, edit)).toBe(next);
          current = next;
          edits.push(edit);
        }}
      />
    </TypstreamProvider>,
  );
  return { view, ref, edits, source: () => current };
};

const editorOf = async (ref: React.RefObject<TypstEditorHandle | null>) => {
  await waitFor(() => expect(ref.current?.editor).toBeTruthy());
  return ref.current?.editor as NonNullable<TypstEditorHandle["editor"]>;
};

describe("<TypstEditor>", () => {
  it("shows Typst as rich text, with code compiled", async () => {
    const { view } = open();
    await waitFor(() => expect(view.container.querySelector(".ts-content h1")?.textContent).toBe("Fractions"));
    expect(view.container.querySelector(".ts-content strong")?.textContent).toBe("same");
    expect(view.container.querySelectorAll(".ts-content li")).toHaveLength(2);
    // The question compiles in the hidden document; its copy shows edu's markup and numbering.
    await waitFor(() => expect(view.container.querySelector(".ts-typst-block .edu-question")).toBeTruthy(), {
      timeout: 30_000,
    });
    expect(view.container.querySelector(".ts-typst-block")?.textContent).toContain("What is");
  });

  it("writes a toolbar's mark as a minimal edit", async () => {
    const { view, ref, edits, source } = open();
    const editor = await editorOf(ref);
    const path = [1, 0];
    act(() => {
      editor.tf.select({ anchor: { path, offset: 0 }, focus: { path, offset: 3 } });
    });
    const toolbar = view.container.querySelector(".ts-fixed-toolbar") as HTMLElement;
    fireEvent.click(toolbar.querySelector('[aria-label="Underline"]') as HTMLElement);
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(source()).toBe(SOURCE.replace("Add *same*", "#underline[Add] *same*"));
    // Everything outside the paragraph is untouched.
    const edit = edits[0] as TextEdit;
    expect(edit.from).toBeGreaterThanOrEqual(SOURCE.indexOf("Add"));
    expect(edit.to).toBeLessThanOrEqual(SOURCE.indexOf("denominators"));
  });

  it("turns a block into a heading", async () => {
    const { ref, source } = open();
    const editor = await editorOf(ref);
    act(() => {
      editor.tf.select({ path: [1, 0], offset: 1 });
    });
    const turnInto = document.querySelector('.ts-fixed-toolbar [aria-label="Turn into"]') as HTMLElement;
    fireEvent.click(turnInto);
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll(".ts-menu-item")].find((el) => el.textContent === "Heading 2");
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    fireEvent.click(item);
    await waitFor(() => expect(source()).toContain("== Add *same* denominators."));
  });

  it("opens the slash menu at a /", async () => {
    const { ref, source } = open("Text.\n");
    const editor = await editorOf(ref);
    act(() => {
      editor.tf.select(editor.api.end([0]));
      editor.tf.insertBreak();
      editor.tf.insertText("/quest");
    });
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll(".ts-popover .ts-menu-item")].find((el) =>
        el.textContent?.startsWith("Question"),
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    fireEvent.click(item);
    await waitFor(() => expect(source()).toBe("Text.\n\n#question(points: 1)[Write the question here.]\n"));
  });

  it("keeps untouched blocks across an outside edit", async () => {
    const { ref } = open();
    const editor = await editorOf(ref);
    const before = editor.children.map((b) => b.id);
    act(() => ref.current?.setSource(SOURCE.replace("- two", "- deux")));
    const after = editor.children.map((b) => b.id);
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(ref.current?.source).toBe(SOURCE.replace("- two", "- deux"));
  });
});
