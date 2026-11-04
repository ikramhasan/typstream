// Documents with diagrams through Typst. In the engine as an app runs it (the generator module loaded
// by URL from the build): the examples in both targets. On engine-wasm with the generator's files:
// keys Typst computes from a block's text find what the generator wrote whatever the block's
// whitespace, errors show in final mode, a document compiled without the generator shows code, and
// every healed stream prefix of the examples compiles (edu's rule: whatever a cut leaves draws).
import { type Diagnostic, definePlugin } from "@typstream/core";
import { heal } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import { mermaid, mermaidExamples } from "../src/index";
import { html, newEngine, pages, problems, render } from "./support/engine";
import { newWasm } from "./support/wasm";

/** Images whose data is an SVG: the diagrams' shapes on a page. */
const drawings = (svg: string): number => svg.match(/<image[^>]+href="data:image\/svg\+xml/g)?.length ?? 0;

describe("in the engine", { timeout: 60_000 }, () => {
  const engine = newEngine();

  it.each(mermaidExamples)("draws the diagrams of $title on pages and in the HTML target", async ({ output }) => {
    const count = output.match(/```mermaid/g)?.length ?? 0;
    const paged = (await render(engine, output, "paged")).state;
    expect(problems(paged.diagnostics)).toEqual([]);
    expect(drawings(pages(paged))).toBe(count);
    const htmlState = (await render(engine, output, "html")).state;
    expect(problems(htmlState.diagnostics)).toEqual([]);
    // As html-compat's pictures, named by their labels, and no code.
    expect(html(htmlState).match(/class="ts-frame" role="img"/g)?.length).toBe(count);
    expect(html(htmlState)).not.toContain("<code");
  });

  it("shows code when no generator ran", async () => {
    const without = definePlugin({ ...mermaid, engine: { ...mermaid.engine, generatorModules: [] } });
    const { state } = await render(engine, mermaidExamples[0]?.output ?? "", "html", [], without);
    expect(problems(state.diagnostics)).toEqual([]);
    expect(html(state)).toContain('<code data-lang="mermaid"');
  });
});

describe("on engine-wasm", () => {
  const wasm = newWasm();
  const plain = newWasm({ plain: true });

  it("finds each block's drawing however its whitespace differs from the generator's text", () => {
    const blocks = [
      "```mermaid\nflowchart LR\n  A --> B\n```",
      "  ```mermaid\n    flowchart LR\n      A --> C\n  ```",
      "```mermaid\r\nflowchart LR\r\n\tA --> D\r\n```",
      '````mermaid\nflowchart LR\n  A["`x`"] --> E\n````',
      "#figure(kind: image, caption: [Cap.])[\n  ```mermaid\n  flowchart LR\n    A --> F\n  ```\n]",
      // The same diagram twice: one drawing.
      "```mermaid\nflowchart LR\n  A --> B\n```",
    ];
    const out = wasm.paged(blocks.join("\n\n"));
    expect(problems(out.diagnostics)).toEqual([]);
    expect(drawings(out.svg)).toBe(blocks.length);
  });

  it("shows pele's error above the code in final mode, and the code while streaming", () => {
    // A document of its own: one that drew this block before would keep that drawing while streaming.
    const wasm = newWasm();
    const text = "```mermaid\nflowchart LR\n  A -->\n```";
    const final = wasm.html(text, "final");
    expect(problems(final.diagnostics)).toEqual([]);
    expect(final.html).toContain("t be drawn");
    expect(final.html).toMatch(/Parse error on line 2/);
    const streaming = wasm.html(text, "streaming");
    expect(streaming.html).not.toContain("t be drawn");
    expect(streaming.html).toContain('<code data-lang="mermaid"');
  });

  // A cut can leave errors of its own (`#figure()` has no body), which the engine's fixers take out: only errors
  // the same prefix doesn't have without the plugin are the plugin's.
  it.each(mermaidExamples)("compiles every healed prefix of $title in both targets as it does without the plugin", ({
    output,
  }) => {
    const failures: string[] = [];
    const errors = (ds: readonly Diagnostic[]) => ds.filter((d) => d.severity === "error").map((d) => d.message);
    for (let end = 1; end <= output.length; end++) {
      const healed = heal(output.slice(0, end)).source;
      for (const target of ["html", "paged"] as const) {
        const own = errors(wasm[target](healed, "streaming").diagnostics);
        const without = errors(plain[target](healed, "streaming").diagnostics);
        if (own.join() !== without.join())
          failures.push(`${target} @${end} ${JSON.stringify(healed.slice(-40))}: ${own[0]}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
