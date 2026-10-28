/// <reference lib="dom" />
// The mind map island in <Typstream> (HTML target), in each browser, with the real engine
// worker: it mounts over its drawing (which assistive technology then skips), opens and closes
// branches by click and keyboard, streams in as one mounted component that is incomplete until
// the document is, keeps the drawing where nothing mounts, and leaves it for print.

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { IslandProps } from "@typstream/core";
import { createEngine, type Engine, fromWorker } from "@typstream/engine";
import { Typstream } from "@typstream/react";
import { StrictMode, useEffect } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { type MindMapData, mindmap } from "../../src/index";
import { MindMapIsland, mindmapIslands } from "../../src/react";

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

const DOC = `= Plants

#mindmap[
  Photosynthesis
  - Inputs
    - Sunlight
    - Water ($H_2 O$)
  - #topic(collapsed: true)[Where]
    - Chloroplasts
    - Leaves
  - Outputs
    - Glucose
    - Oxygen
]

After the map.
`;

/** Labels of the nodes React Flow shows, in document order. */
const shown = (el: HTMLElement) =>
  [...el.querySelectorAll(".react-flow__node")].map((n) => (n as HTMLElement).innerText.replace(/\s+/g, " ").trim());

const node = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLElement>(".react-flow__node")].find((n) => n.innerText.trim().startsWith(label));

describe(`the mind map island in ${server.browser}`, () => {
  it("mounts over its drawing, which assistive technology skips", async () => {
    const { container } = render(
      <Typstream engine={engine} plugins={[mindmap]} islands={mindmapIslands} source={DOC} />,
    );
    await waitFor(() => expect(shown(container).length).toBe(8), { timeout: 30_000 });
    // The centre, three branches, the open ones' leaves; "Where" closed with its count.
    expect(shown(container)).toEqual(
      expect.arrayContaining(["Photosynthesis", "Inputs", "Sunlight", "Water (H₂O)", "Where +2", "Outputs"]),
    );
    const marker = container.querySelector("typstream-island") as HTMLElement;
    expect(marker.hasAttribute("data-typstream-island")).toBe(true);
    const host = marker.querySelector(":scope > .typstream-island") as HTMLElement;
    const drawing = marker.querySelector(":scope > svg") as SVGElement;
    expect(drawing.getAttribute("aria-hidden")).toBe("true");
    // The island covers the drawing exactly: nothing around it moved.
    const [a, b] = [host.getBoundingClientRect(), marker.getBoundingClientRect()];
    expect([a.left, a.top, a.width, a.height]).toEqual([b.left, b.top, b.width, b.height]);
    expect(b.height).toBeGreaterThan(40);
    // No attribution link in a teacher's document.
    expect(container.querySelector(".react-flow__attribution")).toBeNull();
    // The text after the map is below it, not under it.
    const after = [...container.querySelectorAll("p")].find((p) => p.textContent?.includes("After the map"));
    expect(after?.getBoundingClientRect().top).toBeGreaterThanOrEqual(b.bottom - 1);
  });

  it("opens and closes branches by click and keyboard", async () => {
    const { container } = render(
      <Typstream engine={engine} plugins={[mindmap]} islands={mindmapIslands} source={DOC} />,
    );
    await waitFor(() => expect(shown(container).length).toBe(8), { timeout: 30_000 });
    const where = node(container, "Where") as HTMLElement;
    expect(where.getAttribute("aria-label")).toBe("Where (collapsed, 2 hidden)");
    act(() => where.click());
    await waitFor(() => expect(shown(container)).toContain("Chloroplasts"));
    expect(node(container, "Where")?.getAttribute("aria-label")).toBe("Where (expanded)");
    const inputs = node(container, "Inputs") as HTMLElement;
    inputs.focus();
    act(() => {
      inputs.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await waitFor(() => expect(shown(container)).not.toContain("Sunlight"));
    expect(node(container, "Inputs")?.innerText.replace(/\s+/g, " ")).toBe("Inputs +2");
  });

  it("streams in as one mounted island, incomplete until the document is", async () => {
    const seen = { mounts: 0, incomplete: [] as boolean[], nodes: [] as number[] };
    const count = (n: MindMapData["root"]): number => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0);
    const Counting = (props: IslandProps<MindMapData>) => {
      useEffect(() => {
        seen.mounts++;
      }, []);
      seen.incomplete.push(props.isIncomplete);
      seen.nodes.push(count(props.data.root));
      return <MindMapIsland {...props} />;
    };
    const view = (source: string, isStreaming: boolean) => (
      <Typstream
        engine={engine}
        plugins={[mindmap]}
        islands={{ mindmap: Counting }}
        source={source}
        isStreaming={isStreaming}
        schedule={{ minInterval: 0, maxInterval: 100 }}
      />
    );
    const { container, rerender } = render(view("", true));
    // Line by line: each step adds a node, which renders before the next.
    const lines = DOC.split(/(?<=\n)/);
    for (let i = 1; i <= lines.length; i++) {
      rerender(view(lines.slice(0, i).join(""), true));
      await new Promise((r) => setTimeout(r, 150));
    }
    rerender(view(DOC, false));
    await waitFor(() => expect(seen.incomplete.at(-1)).toBe(false), { timeout: 30_000 });
    await waitFor(() => expect(shown(container).length).toBe(8));
    expect(seen.mounts).toBe(1);
    expect(seen.incomplete).toContain(true);
    expect(Math.max(...seen.nodes)).toBe(10);
    // The map grew as it streamed in: some render showed part of it.
    expect(seen.nodes.some((n) => n > 1 && n < 10)).toBe(true);
  });

  it("keeps the drawing without a component or without the plugin's island", async () => {
    const { islands: _, ...drawingOnly } = mindmap;
    for (const props of [{ plugins: [mindmap] }, { plugins: [drawingOnly], islands: mindmapIslands }]) {
      const { container, unmount } = render(<Typstream engine={engine} source={DOC} {...props} />);
      await waitFor(() => expect(container.querySelector("typstream-island svg")).not.toBeNull(), {
        timeout: 30_000,
      });
      expect(container.querySelector(".typstream-island")).toBeNull();
      expect(container.querySelector("typstream-island svg")?.hasAttribute("aria-hidden")).toBe(false);
      unmount();
    }
  });

  it("works under StrictMode, and leaves the drawing to print", async () => {
    const { container } = render(
      <StrictMode>
        <Typstream engine={engine} plugins={[mindmap]} islands={mindmapIslands} source={DOC} />
      </StrictMode>,
    );
    await waitFor(() => expect(shown(container).length).toBe(8), { timeout: 30_000 });
    expect(container.querySelectorAll(".typstream-island")).toHaveLength(1);
    // What print gets: the host's print rule hides it.
    const rules = [...document.adoptedStyleSheets].flatMap((s) => [...s.cssRules]);
    const print = rules.find((r) => r instanceof CSSMediaRule && r.conditionText === "print") as CSSMediaRule;
    expect(print?.cssText).toMatch(/\.typstream-island\)?\s*\{\s*display: none;/);
  });
});
