import { readFileSync } from "node:fs";
import { hasErrors, loadSyntax, parse } from "@typstream/syntax";
import { expect } from "vitest";
import { EditorState, type Transaction } from "../src/index";

/** Loads the parser from the bytes its build wrote (Node's fetch can't read files). */
export const load = (): Promise<void> =>
  loadSyntax(readFileSync(new URL("../../syntax/wasm/syntax_bg.wasm", import.meta.url)));

/**
 * A state from a document marked up with its selection: `‸` is the caret, `«…»` a selection
 * (anchor at `«`, head at `»`).
 */
export const state = (marked: string): EditorState => {
  const caret = marked.indexOf("‸");
  if (caret >= 0) return new EditorState(marked.replace("‸", ""), { anchor: caret, head: caret });
  const a = marked.indexOf("«");
  const b = marked.indexOf("»") - 1;
  return new EditorState(marked.replace("«", "").replace("»", ""), { anchor: a, head: b });
};

/** The state marked up as `state` reads it. */
export const show = (s: EditorState): string => {
  const { anchor, head, node } = s.selection;
  if (anchor === head) return `${s.text.slice(0, head)}‸${s.text.slice(head)}`;
  const [a, b] = [Math.min(anchor, head), Math.max(anchor, head)];
  const [open, close] = node ? ["[[", "]]"] : ["«", "»"];
  return `${s.text.slice(0, a)}${open}${s.text.slice(a, b)}${close}${s.text.slice(b)}`;
};

/** Runs a command on a marked-up document; the result marked up, checked to parse without errors. */
export const run = (marked: string, command: (s: EditorState) => Transaction | null): string | null => {
  const before = state(marked);
  const tr = command(before);
  if (!tr) return null;
  const { state: after } = before.apply(tr);
  if (!hasErrors(parse(before.text)))
    expect(hasErrors(parse(after.text)), `parses: ${JSON.stringify(after.text)}`).toBe(false);
  return show(after);
};
