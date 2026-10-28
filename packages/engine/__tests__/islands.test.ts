// Island markers in the paged target (PLAN §8.4, #28): engine-wasm finds every `metadata`
// labelled `<typstream-island>` in the laid-out document, and the server sends them with each
// paged artifact, past the preamble and in the client's coordinates, whichever pages changed.
// The renderers mount islands over them; `@typstream/mindmap` writes real ones.
import type { PagedArtifact, PagedIsland } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

/** An island function as plugins write one: the marker at the top left of a full-width block. */
const PREAMBLE = `#let island(name, data, body) = layout(size => block(breakable: false, width: 100%, {
  let value = (name: name, data: data, width: size.width / 1pt, height: measure(body).height / 1pt, source: body)
  [#metadata(value)<typstream-island>]
  body
}))
#set page(width: 200pt, height: 300pt, margin: 20pt)
`;

const compile = async (text: string): Promise<PagedArtifact> => {
  const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
  const doc = engine.open({ target: "paged", preamble: PREAMBLE, text });
  doc.finish();
  const state = await new Promise<ReturnType<typeof doc.getState>>((resolve) => {
    doc.subscribe((s) => s.status === "done" && resolve(s));
  });
  engine.dispose();
  expect(state.diagnostics).toEqual([]);
  return state.artifact as PagedArtifact;
};

describe("island markers in paged artifacts", () => {
  it("are listed with their page, position, size, data and source offset", async () => {
    const text = `= Title

#island("map", (n: 1, s: "a"))[Hello *world* #rect(width: 50pt, height: 40pt)]

#pagebreak()
Before.
#island("map", (n: 2))[#v(10pt) Second]
`;
    const artifact = await compile(text);
    expect(artifact.pageCount).toBe(2);
    const [first, second] = artifact.islands as PagedIsland[];
    expect(first).toMatchObject({ name: "map", data: { n: 1, s: "a" }, page: 0, x: 20, width: 160 });
    expect(first?.y).toBeGreaterThan(20);
    expect(first?.height).toBeGreaterThan(40);
    expect(first?.from).toBe(text.indexOf("[Hello"));
    expect(second).toMatchObject({ name: "map", data: { n: 2 }, page: 1, x: 20 });
    // Below "Before.", which starts the page.
    expect(second?.y).toBeGreaterThan(25);
    expect(second?.from).toBe(text.indexOf("[#v(10pt)"));
  });

  it("are left out when their value isn't an island's", async () => {
    const artifact = await compile(`#metadata("x")<typstream-island>
#metadata((name: 1, width: 1, height: 1))<typstream-island>
#metadata((name: "ok", width: 10, height: 5))<typstream-island>
Text.`);
    expect(artifact.islands?.map((i) => [i.name, i.from])).toEqual([["ok", null]]);
  });

  it("are an empty list in a document without any", async () => {
    expect((await compile("No islands.")).islands).toEqual([]);
  });
});
