/// <reference lib="dom" />
// The HTML renderer's browser tests: the real engine worker (as in
// @typstream/engine's browser tests) with html-compat, and corpus documents.

import { createEngine, type DocumentState, type Engine, type EngineDocument, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusEntries(): Promise<CorpusDocument[]>;
  }
}

export interface CorpusDocument {
  name: string;
  source: string;
  chunks: string[];
  /** Its assets, at paths relative to the document. */
  files: Record<string, string>;
}

export const startEngine = (): Engine =>
  createEngine({
    spawn: fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" })),
    spare: false,
  });

/** A document with html-compat applied, as the bindings will open them. */
export const openHtml = (engine: Engine, files: Record<string, string> = {}): EngineDocument =>
  engine.open({
    target: "html",
    preamble: htmlCompat.engine?.preamble ?? "",
    files: { ...(htmlCompat.engine?.files as Record<string, string>), ...files },
  });

/** Resolves with the first state that satisfies `done` (now or later). */
export const until = (doc: EngineDocument, done: (s: DocumentState) => boolean, ms = 60_000): Promise<DocumentState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; status ${doc.getState().status}`)), ms);
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

/** The HTML of a whole document, compiled in final mode. */
export const compileHtml = async (doc: EngineDocument, source: string): Promise<string> => {
  doc.set(source);
  doc.finish();
  const s = await until(doc, (s) => s.status === "done" || s.status === "error");
  if (s.artifact?.target !== "html") throw new Error(`no HTML: ${JSON.stringify(s.diagnostics.slice(0, 3))}`);
  return s.artifact.html;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pushes `chunks` at `tokensPerSecond`, calling `onArtifact` with every new
 * HTML artifact and the state it came with, then finishes and resolves with the
 * final state.
 */
export const stream = async (
  doc: EngineDocument,
  chunks: readonly string[],
  tokensPerSecond: number,
  onArtifact: (html: string, state: DocumentState) => void,
): Promise<DocumentState> => {
  let last: unknown = null;
  const stop = doc.subscribe((s) => {
    if (s.artifact && s.artifact !== last && s.artifact.target === "html") {
      last = s.artifact;
      onArtifact(s.artifact.html, s);
    }
  });
  const start = performance.now();
  let i = 0;
  while (i < chunks.length) {
    await sleep(4);
    const due = Math.min(chunks.length, Math.ceil(((performance.now() - start) / 1000) * tokensPerSecond));
    for (; i < due; i++) doc.push(chunks[i] as string);
  }
  doc.finish();
  const final = await until(doc, (s) => s.status === "done" || s.status === "error");
  stop();
  return final;
};

const section = (i: number): string => `
== Section ${i}: roots of polynomials
Let $f(x) = sum_(k=0)^n a_k x^k$ be a polynomial of degree $n$ with *real* coefficients. We study how
the roots move as the coefficients $a_k$ vary, and give a short argument for the bound
$|z| <= 1 + max_k |a_k / a_n|$. The proof is _elementary_ and uses only the triangle inequality.

$ |f(z)| >= |a_n| |z|^n - sum_(k<n) |a_k| |z|^k > 0 quad "for" |z| > R $

#table(columns: 4, [$k$], [$a_k$], [$|a_k|$], [note],
  [0], [$-1$], [1], [constant], [1], [$1/2$], [0.5], [linear], [2], [$pi$], [3.14], [quadratic])

Students often confuse the *degree* of a polynomial with the number of distinct roots:
- the fundamental theorem of algebra counts roots with multiplicity;
- a real polynomial of odd degree has at least one real root;
- complex roots of real polynomials come in conjugate pairs.

Some more prose follows, so that the section has a realistic paragraph length. A careful reader
will check each step of the argument against a small example such as $x^2 - 2$, whose roots
$plus.minus 1.414$ lie well inside the bound.
`;

/** About twenty A4 pages of worksheet material (four times @typstream/engine's FIVE_PAGES). */
export const TWENTY_PAGES = `#set heading(numbering: "1.")\n= A twenty page handout\n${Array.from(
  { length: 44 },
  (_, i) => section(i + 1),
).join("")}`;

/** Splits text into token-sized chunks (words and the space before them). */
export const tokens = (text: string): string[] => text.match(/\s*\S+|\s+$/g) ?? [];
