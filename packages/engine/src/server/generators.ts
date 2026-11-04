// File generators (PLAN §8.2): plugins' code that makes files from a document's source before
// each compile, for what Typst can't compute itself (`@typstream/mermaid` draws diagrams with a
// JavaScript library). Each document gets its own instance of every generator; the worker writes
// only what changed since the last run, so a generator that returns the same files costs Typst
// nothing (comemo keys on the files' contents).

import type { CompileMode, DocumentFileGenerator, FileContent, FileDelta, FileGenerator } from "@typstream/core";

/** A generator module's default export as generators; throws on anything else. */
export const generatorsOf = (exported: unknown, url: string): FileGenerator[] => {
  const list = Array.isArray(exported) ? exported : [exported];
  for (const g of list) {
    const generator = g as Partial<FileGenerator> | null;
    if (!generator || typeof generator.name !== "string" || typeof generator.open !== "function") {
      throw new Error(`${url}: the default export must be a file generator ({ name, open }) or an array of them`);
    }
  }
  return list as FileGenerator[];
};

/** Imports a file generator module. */
export const loadGenerators = async (url: string): Promise<FileGenerator[]> => {
  let module: { default?: unknown };
  try {
    // A URL known only at runtime: bundlers must leave the import as it is (Turbopack otherwise makes it throw
    // "module not found", webpack too).
    module = await import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  } catch (e) {
    throw new Error(`file generator module ${url} failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
  return generatorsOf(module.default, url);
};

interface Running {
  name: string;
  session: DocumentFileGenerator;
  /** What it provided last, as written. */
  files: Map<string, FileContent>;
}

/** One document's generators, and the files each provided last. */
export class DocumentGenerators {
  private readonly running: Running[];

  constructor(
    generators: readonly FileGenerator[],
    private readonly log: (level: "warn" | "error", message: string) => void,
  ) {
    this.running = [];
    for (const g of generators) {
      try {
        this.running.push({ name: g.name, session: g.open(), files: new Map() });
      } catch (e) {
        log("error", `file generator ${g.name} failed to open: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * Runs every generator on `source` and returns the files that changed since the last run:
   * new or different contents, and `null` for those no longer provided. `null` when nothing
   * changed. A generator that throws keeps its files as they were, and is logged.
   */
  async run(source: string, mode: CompileMode): Promise<FileDelta | null> {
    let delta: FileDelta | null = null;
    for (const r of this.running) {
      let next: Record<string, FileContent>;
      try {
        next = await r.session.files(source, { mode });
      } catch (e) {
        this.log("error", `file generator ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const [path, content] of Object.entries(next)) {
        if (r.files.get(path) === content) continue;
        r.files.set(path, content);
        delta ??= {};
        delta[path] = content;
      }
      for (const path of r.files.keys()) {
        if (Object.hasOwn(next, path)) continue;
        r.files.delete(path);
        delta ??= {};
        delta[path] = null;
      }
    }
    return delta;
  }

  close(): void {
    for (const r of this.running) {
      try {
        r.session.close?.();
      } catch {
        // The document is gone either way.
      }
    }
  }
}
