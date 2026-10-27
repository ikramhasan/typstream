// Events and telemetry hooks (PLAN §8.6, §12). The library sends nothing
// anywhere: the engine client emits these per document, the renderers add what
// they drew, and the app decides what to log or collect (heal patches by rule,
// fixer hits by error, fallback levels, watchdog strikes, compile latency).
// Every field is plain data, so an event can be serialized as it is.

import type { Diagnostic } from "./diagnostic";
import type { Range } from "./index";
import type { AppliedFix, CompileMode, CompileTarget, CompileTimings, DocumentUri, Revision } from "./protocol";

/**
 * Which step of the fallback ladder (PLAN §5.6) the document's output came
 * from:
 *
 * - `0`: the text itself (healed, and fixed by Layer 3 if it needed it).
 * - `1`: the compile failed; the last good artifact stays.
 * - `2`: the settled text, with the unsettled tail as plain text (streaming).
 * - `3`: failing or hanging blocks shown as error boxes.
 * - `4`: nothing compiled: the whole document shown as its source (final mode).
 * @public
 */
export type FallbackLevel = 0 | 1 | 2 | 3 | 4;

/** What every document event says about the compile it is about. @public */
export interface DocumentEventBase {
  uri: DocumentUri;
  /** Revision compiled. Revisions count the worker's copies of the document, not the input's chunks. */
  rev: Revision;
  target: CompileTarget;
  /** `final` once the input is complete (`finish()`). */
  mode: CompileMode;
}

/**
 * What a compile cost and what it took to make the text compile: the fields
 * `compiled` and `rendered` events share.
 * @public
 */
export interface CompileReport {
  /** The worker's timings (`totalMs`: request to response). */
  timings: CompileTimings;
  /** Typst's compilation, summed over fixer rounds and fallback compiles (`timings.compileMs`, 0 when absent). */
  compileMs: number;
  /**
   * Main-thread time healing the input since the previous compile, ms: every
   * push and edit that led to the compiled source, summed.
   */
  healMs: number;
  /** Heal patches (lint fixes, tail repair, output handlers) in the compiled source. */
  patches: number;
  /** The same patches counted by their reason (`"close:]"`, `"lint:email-at"`, …). */
  patchReasons: Record<string, number>;
  /** Errors Layer 3's fixers fixed to make the output, in the order fixed (PLAN §5.5). */
  fixersApplied: AppliedFix[];
  /** See {@link FallbackLevel}. */
  fallbackLevel: FallbackLevel;
  /** Errors and warnings of the compile, in the document. */
  errors: number;
  warnings: number;
  /** Paged: the document's page count, when the compile published pages. */
  pages?: number;
  /** Length of the compiled source (UTF-16), for latency by document size. */
  sourceLength: number;
}

/**
 * A compile finished, whether or not it published an artifact. Probe compiles
 * of a hang search (PLAN §5.6) aren't reported; the `watchdog` events that
 * started the search are.
 * @public
 */
export interface CompiledEvent extends DocumentEventBase, CompileReport {
  type: "compiled";
  /** `ok`: it published an artifact (perhaps from the fallback); `error`: the last good one stays. */
  status: "ok" | "error";
}

/**
 * The renderer showed an artifact: the report of the compile that made it,
 * and what drawing it cost. What `onRendered` hooks receive.
 * @public
 */
export interface RenderedEvent extends DocumentEventBase, CompileReport {
  type: "rendered";
  /** Main-thread time handing the artifact to the renderer, ms (paged: offscreen pages draw later). */
  renderMs: number;
  /** HTML: top-level blocks shown. */
  blocks?: number;
}

/**
 * The document's output isn't its text as it is (levels 1 to 4 of
 * {@link FallbackLevel}): a candidate corpus case (PLAN §11.2). Fired with
 * every such compile, so a lasting error in a stream fires once per revision;
 * `consecutive` tells a new failure from a lasting one.
 * @public
 */
export interface FallbackEvent extends DocumentEventBase {
  type: "fallback";
  level: Exclude<FallbackLevel, 0>;
  /** Ranges of the compiled source shown as error boxes (levels 3 and 4). */
  isolated: Range[];
  /** Level 2: the compiled source from here on was shown as plain text. */
  plainFrom: number | null;
  /** Compiles in a row, this one included, whose output wasn't the text as it is. */
  consecutive: number;
  /**
   * The compile's diagnostics (input coordinates): the errors that failed it,
   * or that the error boxes stand for; under the stable prefix, the tail's
   * errors as `info` (`source: "stable-prefix"`).
   */
  diagnostics: Diagnostic[];
  /** The input the compiled source was healed from: what to replay to reproduce it. */
  input: string;
  /** The healed source the worker compiled. Ranges above are in it. */
  source: string;
}

/**
 * A compile of the document ran past its budget or crashed the worker, which
 * was replaced (PLAN §6.3).
 * @public
 */
export interface WatchdogEvent extends DocumentEventBase {
  type: "watchdog";
  reason: "timeout" | "crash";
  /** The compile's budget, ms. */
  budgetMs: number;
  /** Streaming timeouts and crashes so far; at the engine's limit live compiling stops. */
  strikes: number;
  /** False once live compiling stopped (`too-complex`); the document compiles again when finished. */
  live: boolean;
  /**
   * Final mode: the engine is looking for the blocks that hang or crash it, to
   * skip them, rather than counting a strike.
   */
  searching: boolean;
  /** Length of the compiled source (UTF-16). */
  sourceLength: number;
}

/**
 * A compile replaced the document's diagnostics (in input coordinates,
 * sorted). Fired with every compile that reports, even when they didn't change.
 * @public
 */
export interface DiagnosticsEvent extends DocumentEventBase {
  type: "diagnostics";
  diagnostics: Diagnostic[];
}

/**
 * Everything a document reports, from `EngineDocument.onEvent` (and, with its
 * `uri`, `Engine.onEvent`). For one compile: `diagnostics`, then `compiled`,
 * then `fallback` if it fell back; a watchdog stop reports `watchdog` instead.
 * @public
 */
export type DocumentEvent = CompiledEvent | FallbackEvent | WatchdogEvent | DiagnosticsEvent;
