// @typstream/universe: the Typst Universe packages typstream allows by default
// (PLAN §6.4, #25), vendored as the unmodified tarballs packages.typst.org
// serves. Bundlers emit each tarball as an asset (`new URL(…, import.meta.url)`),
// so the engine fetches them from the app's own origin, and only when a
// document imports one. Integrity hashes are of the uncompressed `.tar`: servers
// often send `.gz` files with `Content-Encoding: gzip` (Vite's dev server does),
// and then the browser hands over the tar. `scripts/vendor.mjs --check`
// compares the tarballs with upstream.
//
// Day one (#1: "diagrams, chemistry, math"): CeTZ and fletcher for diagrams,
// cetz-plot, physica and unify for math, chemformula and alchemist for
// chemistry. The rest are their exact dependencies. `scripts/vendor.mjs`
// downloads and checks them.

import { definePlugin, type PackageSpec } from "@typstream/core";

/** What a document imports a package for. @public */
export type UniverseTopic = "diagrams" | "math" | "chemistry";

/**
 * A vendored Typst Universe package: a {@link @typstream/core#PackageSpec} with
 * its tarball's URL and integrity (of the uncompressed tar) always set.
 * @public
 */
export interface UniversePackage extends PackageSpec {
  /** The vendored `.tar.gz`, next to this package's JS: bundlers emit it as an asset. */
  url: string;
  /** `sha256-…` of the uncompressed tar. */
  integrity: string;
  /** Set on the packages documents import; unset on those that only come in as another's dependency. */
  topic?: UniverseTopic;
  /** One line for the prompt: what it's for and how it's called. */
  summary?: string;
}

const preview = (
  name: string,
  version: string,
  url: URL,
  integrity: string,
  use?: { topic: UniverseTopic; summary: string },
): UniversePackage => ({ namespace: "preview", name, version, url: url.href, integrity, ...use });

/**
 * Every vendored package, dependencies included. Each `new URL` is a literal so
 * bundlers can see it.
 * @public
 */
export const UNIVERSE_PACKAGES: readonly UniversePackage[] = [
  preview(
    "cetz",
    "0.5.3",
    new URL("../vendor/cetz-0.5.3.tar.gz", import.meta.url),
    "sha256-7uRpaPfYuRjZ0EkPoOM2gkZlOASeDzSguTSJWUx+PVo=",
    {
      topic: "diagrams",
      // #24: models call Typst's `polygon` and `ellipse` in a canvas, where `cetz.draw` shadows them.
      summary:
        "drawings: `#cetz.canvas({ import cetz.draw: *; line((0, 0), (4, 0), (2, 3), close: true); circle((6, 1), radius: (2, 1)); rect((9, 0), (11, 2)); content((2, -0.5), [4 cm]) })`. In a canvas these replace Typst's shapes: a polygon is `line(.., close: true)`, an ellipse a `circle` with two radii",
    },
  ),
  preview(
    "fletcher",
    "0.5.8",
    new URL("../vendor/fletcher-0.5.8.tar.gz", import.meta.url),
    "sha256-vtCQZc1kBvcTg4tcVXGaNsHxtiqCQEq3JVbegOy5rXw=",
    {
      topic: "diagrams",
      summary:
        'flowcharts, state and commutative diagrams; import `diagram, node, edge`: `#diagram(node((0, 0), [A]), edge("-|>"), node((1, 0), [B]))`',
    },
  ),
  preview(
    "cetz-plot",
    "0.1.4",
    new URL("../vendor/cetz-plot-0.1.4.tar.gz", import.meta.url),
    "sha256-I/KwwAqNhHnJ9ghzhtfoWY6ZYIfOzPMktulXDX2CMc0=",
    {
      topic: "math",
      summary:
        "function graphs and charts in a CeTZ canvas; import `plot`: `#cetz.canvas(plot.plot(size: (6, 4), { plot.add(domain: (-2, 2), x => x * x) }))`",
    },
  ),
  preview(
    "physica",
    "0.9.8",
    new URL("../vendor/physica-0.9.8.tar.gz", import.meta.url),
    "sha256-gLyLUm7L9oiszlLGmleQxWZRE4LWGZnWaGgQacVQBQs=",
    {
      topic: "math",
      summary: "calculus and physics notation in math; import `*`: `$dv(f, x)$`, `$pdv(u, x, y)$`, `$vb(F)$`",
    },
  ),
  preview(
    "unify",
    "0.8.1",
    new URL("../vendor/unify-0.8.1.tar.gz", import.meta.url),
    "sha256-m5t0SW3fByFSrqtdTqvD87gky+/ZphP4wY6a3cVm9T8=",
    {
      topic: "math",
      summary:
        'numbers and SI units; import `num, qty, unit`: `#qty("9.81", "m/s^2")`, `#num("1.2e5")`, `#unit("kg m s^-2")`',
    },
  ),
  preview(
    "chemformula",
    "0.1.3",
    new URL("../vendor/chemformula-0.1.3.tar.gz", import.meta.url),
    "sha256-g9dEimwQXuFvLIk70BB78v5DHwZVqkyI66yIJk/kUMw=",
    {
      topic: "chemistry",
      summary:
        'formulas and equations, mhchem-style; import `ch`: `#ch("2H2 + O2 -> 2H2O")`, `#ch("CuSO4*5H2O")`; arrow labels are math, so quote words: `->["heat"]`',
    },
  ),
  preview(
    "alchemist",
    "0.2.0",
    new URL("../vendor/alchemist-0.2.0.tar.gz", import.meta.url),
    "sha256-wp9SMhMi3ZJtK/nDi5cRrE8xBJQ4NsGhDz+G82kBUMg=",
    {
      topic: "chemistry",
      summary: 'structural formulas; import `*`: `#skeletize({ fragment("H_3C"); single(); fragment("OH") })`',
    },
  ),
  // Dependencies, pinned exactly by the packages above.
  preview(
    "cetz",
    "0.5.2",
    new URL("../vendor/cetz-0.5.2.tar.gz", import.meta.url),
    "sha256-1HwM5S7MWYfEKdi/jA5hf/er+oCJ5G8OAmJFqTO94NI=",
  ),
  preview(
    "cetz",
    "0.3.4",
    new URL("../vendor/cetz-0.3.4.tar.gz", import.meta.url),
    "sha256-HBkbw1TTedKFYNU/UE0Rxm/XIFvzanWHS37qp12rXK8=",
  ),
  preview(
    "oxifmt",
    "1.0.0",
    new URL("../vendor/oxifmt-1.0.0.tar.gz", import.meta.url),
    "sha256-XS/0bduus8C6ZZTZ999XCbC5z8JILO0EbFryxrztj0o=",
  ),
  preview(
    "oxifmt",
    "0.2.1",
    new URL("../vendor/oxifmt-0.2.1.tar.gz", import.meta.url),
    "sha256-SHrUfkIQznu2YJIMfuGQDBLgkHTQefibSdMwJ/oG78k=",
  ),
];

const spec = (p: PackageSpec): string => `@${p.namespace}/${p.name}:${p.version}`;

/**
 * The vendored packages as a typstream plugin: the engine's package allowlist
 * (`engine.packages`) and prompt rules naming what the model may import.
 * `typstream`'s `<Typstream>` adds it by default.
 * @public
 */
export const universe = definePlugin({
  key: "universe",
  engine: {
    packages: UNIVERSE_PACKAGES.map(({ namespace, name, version, url, integrity }) => ({
      namespace,
      name,
      version,
      url,
      integrity,
    })),
  },
  prompt: {
    rules: [
      "Typst packages: import only these, at exactly these versions. Anything else fails to compile.",
      ...UNIVERSE_PACKAGES.filter((p) => p.topic).map((p) => `\`#import "${spec(p)}"\` (${p.topic}): ${p.summary}`),
    ],
  },
});
