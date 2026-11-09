// Where the Typst package and the generated files live in the engine, shared by the plugin and the
// generator (the worker module), so the two can't disagree.

/** The Typst package's version, as in its `typst.toml`. */
export const MERMAID_VERSION = "0.1.0";

/**
 * The package spec the files are mounted under: `${MERMAID_ROOT}/lib.typ` and so on, a local
 * package the engine reads from the files the plugin mounts (as `@typstream/mindmap`'s).
 */
export const MERMAID_ROOT = `@typstream/mermaid:${MERMAID_VERSION}`;

/** The index of drawn diagrams, by key, which `lib.typ` reads (inside the package: `diagrams.json`). */
export const INDEX_FILE = `${MERMAID_ROOT}/diagrams.json`;

/** The directory of the diagrams' shapes, one SVG file per drawing, named by its hash. */
export const SVG_DIR = "diagrams";
