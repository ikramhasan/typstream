// A model's edits, written as labelled text (#34, PLAN §5.2):
//
//   Made question 3 harder.
//   <edit>
//   <old>
//   #question(points: 2)[What is $3 + 4$?]
//   </old>
//   <new>
//   #question(points: 3)[What is $37 + 48$?]
//   </new>
//   </edit>
//
// The model quotes the text it replaces, as coding agents do, rather than naming
// numbered blocks: an app whose chat history can't be rewritten tells the model
// about a teacher's edits as diffs, so the model never sees a numbered copy of
// the current document, and a stale number would rewrite the wrong part where a
// stale quote fails to match. Typst stays raw inside the tags (no JSON escaping).
// Anything outside them is a message to the teacher.
//
// The parser reads an answer as far as it has arrived and is called again with
// more: a tag cut at the end of a chunk (`</ne`) is held back, never read as
// text. It's lenient where models drift: a ```typst fence around a quote or the
// new text, a missing `</edit>`.

/**
 * One `<edit>` of a model's answer, as far as it has arrived.
 * @public
 */
export interface EditOp {
  /** The quoted text the edit replaces (`<old>`), so far. */
  quote: string;
  /** Whether the quote is complete (`</old>` arrived). */
  quoteDone: boolean;
  /** The text that replaces it (`<new>`), so far. */
  text: string;
  /** Whether the new text is complete (`</new>` arrived). */
  done: boolean;
  /** Set when the edit isn't written as `<edit><old>…</old><new>…</new></edit>`. */
  malformed?: boolean;
}

/**
 * A model's answer read as edits: {@link parseEdits}'s result.
 * @public
 */
export interface ParsedAnswer {
  /** The edits, in the order the model wrote them. */
  edits: EditOp[];
  /** The text outside the tags, for the teacher: trimmed, blank runs collapsed. */
  message: string;
}

const EDIT = "<edit>";
const END_EDIT = "</edit>";

/** The length of the longest end of `text` that starts `tag` (a tag cut by the chunk). */
const cutTag = (text: string, tag: string): number => {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
};

/**
 * The quote or new text between its tags (or a selection edit's replacement): without the line
 * breaks after and before them, or a fence.
 * @internal
 */
export const stripFence = (raw: string, done: boolean): string => {
  let text = raw.replace(/^\r?\n/, "");
  // While it streams, what may be a fence's opening line is held back.
  if (!done && /^`{1,3}[\w-]*[ \t]*$/.test(text)) return "";
  const fence = /^```[\w-]*[ \t]*\r?\n/.exec(text);
  if (fence) {
    text = text.slice(fence[0].length);
    const close = /\r?\n```[ \t]*\r?\n?$/.exec(text);
    if (close) text = text.slice(0, close.index);
    // While it streams, the fence's closing backticks may be arriving.
    else if (!done) text = text.replace(/\r?\n`{1,3}$/, "");
  }
  // The line break before the closing tag. While the text streams, any line break at its end may be that one.
  return text.replace(/\r?\n$/, "");
};

/** Skips whitespace; the offset of the first other character. */
const skipSpace = (text: string, at: number): number => {
  while (at < text.length && /\s/.test(text[at] as string)) at++;
  return at;
};

/**
 * Reads a model's answer as edits and a message. `answer` is the answer so far,
 * `final` whether it is complete: until then, a tag cut at its end is held back.
 * Call it again with the longer answer as more arrives; the edits only grow.
 * @public
 */
export const parseEdits = (answer: string, final = false): ParsedAnswer => {
  const edits: EditOp[] = [];
  let message = "";
  let at = 0;
  while (at < answer.length) {
    const open = answer.indexOf(EDIT, at);
    if (open < 0) {
      const rest = answer.slice(at);
      message += final ? rest : rest.slice(0, rest.length - cutTag(rest, EDIT));
      break;
    }
    message += `${answer.slice(at, open)}\n`;
    at = open + EDIT.length;
    const op: EditOp = { quote: "", quoteDone: false, text: "", done: false };
    edits.push(op);
    at = readOp(answer, at, op, final);
  }
  return { edits, message: message.replace(/\n{3,}/g, "\n\n").trim() };
};

/** Reads `<old>…</old><new>…</new></edit>` from `at` into `op`; where reading goes on. */
const readOp = (answer: string, from: number, op: EditOp, final: boolean): number => {
  let at = skipSpace(answer, from);
  const quote = readPart(answer, at, "old", final);
  if (quote === "pending") return answer.length;
  if (quote === null) {
    op.malformed = true;
    return at;
  }
  op.quote = quote.text;
  op.quoteDone = quote.done;
  if (!quote.done) return answer.length;
  at = skipSpace(answer, quote.end);
  const text = readPart(answer, at, "new", final);
  if (text === "pending") return answer.length;
  if (text === null) {
    op.malformed = true;
    return at;
  }
  op.text = text.text;
  op.done = text.done;
  if (!text.done) return answer.length;
  at = skipSpace(answer, text.end);
  // A missing `</edit>` is forgiven: the edit ended with its `</new>`.
  if (answer.startsWith(END_EDIT, at)) return at + END_EDIT.length;
  if (!final && at === answer.length) return at;
  if (!final && END_EDIT.startsWith(answer.slice(at))) return answer.length;
  return text.end;
};

type Part = { text: string; done: boolean; end: number };

/**
 * `<tag>…</tag>` at `at`: its content so far; `"pending"` while the opening tag
 * may still be arriving; `null` when something else is there.
 */
const readPart = (answer: string, at: number, tag: string, final: boolean): Part | "pending" | null => {
  const open = `<${tag}>`;
  if (!answer.startsWith(open, at)) {
    return !final && open.startsWith(answer.slice(at)) ? "pending" : null;
  }
  const start = at + open.length;
  const close = `</${tag}>`;
  const end = answer.indexOf(close, start);
  if (end >= 0) return { text: stripFence(answer.slice(start, end), true), done: true, end: end + close.length };
  let raw = answer.slice(start);
  if (!final) raw = raw.slice(0, raw.length - cutTag(raw, close));
  return { text: stripFence(raw, false), done: false, end: answer.length };
};
