/// <reference lib="dom" />
// The mind map island in <Typstream>, in each browser, with the real engine worker: it mounts
// over its drawing (which assistive technology then skips), in the HTML target and over a page
// (paged target, whose canvas stays Typst's drawing), opens and closes branches by click and
// keyboard, streams in as one mounted component that is incomplete until the document is, keeps
// the drawing where nothing mounts, and leaves it for print.

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

  it("mounts over its drawing on a page, which stays Typst's drawing, its text skipped by assistive technology", async () => {
    const page = (islands?: typeof mindmapIslands) => {
      const el = document.createElement("div");
      el.style.width = "600px";
      document.body.append(el);
      const { container } = render(
        <Typstream
          engine={engine}
          plugins={[mindmap]}
          source={DOC}
          target="paged"
          layout="fit-width"
          {...(islands ? { islands } : {})}
        />,
        { container: el },
      );
      return container;
    };
    const container = page(mindmapIslands);
    const plain = page();
    await waitFor(() => expect(shown(container).length).toBe(8), { timeout: 30_000 });
    const pageEl = container.querySelector(".typstream-page") as HTMLElement;
    const box = pageEl.querySelector(".typstream-islands > .typstream-island-box") as HTMLElement;
    expect(box.hasAttribute("data-typstream-island")).toBe(true);
    const host = box.querySelector(":scope > .typstream-island") as HTMLElement;
    const [a, b, p] = [host.getBoundingClientRect(), box.getBoundingClientRect(), pageEl.getBoundingClientRect()];
    expect([a.left, a.top, a.width, a.height]).toEqual([b.left, b.top, b.width, b.height]);
    expect(b.height).toBeGreaterThan(40);
    expect(b.left).toBeGreaterThan(p.left);
    expect(b.right).toBeLessThan(p.right);
    // The island paints the paper's white over the drawing.
    expect(getComputedStyle(host.querySelector(".ts-mindmap") as Element).backgroundColor).toBe("rgb(255, 255, 255)");
    // The text layer: the map's labels are the island's to read; the text around it isn't.
    await waitFor(() => expect(pageEl.querySelector(".typstream-text-layer span")).not.toBeNull());
    const runs = [...pageEl.querySelectorAll(".typstream-text-layer span:not([role])")];
    const hidden = (text: string) =>
      runs.filter((r) => r.textContent?.includes(text)).map((r) => r.getAttribute("aria-hidden") === "true");
    expect(hidden("Photosynthesis")).toEqual([true]);
    expect(hidden("After")).toEqual([false]);
    const after = runs.find((r) => r.textContent?.includes("After")) as Element;
    expect(after.getBoundingClientRect().top).toBeGreaterThanOrEqual(b.bottom - 1);
    // The canvas under it is the page as it prints and exports, the same as without islands.
    const pixels = async (el: HTMLElement) => {
      const canvas = await waitFor(
        () => {
          const c = el.querySelector<HTMLCanvasElement>(".typstream-page > canvas");
          expect(c?.width).toBeGreaterThan(0);
          return c as HTMLCanvasElement;
        },
        { timeout: 30_000 },
      );
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [withIsland, without] = await Promise.all([pixels(container), pixels(plain)]);
    expect(withIsland.length).toBe(without.length);
    expect(withIsland.every((v, i) => v === without[i])).toBe(true);
    expect(plain.querySelector(".typstream-islands")).toBeNull();
  });

  it.each([
    "html",
    "paged",
  ] as const)("streams in as one mounted island, incomplete until the document is (%s)", async (target) => {
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
        target={target}
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
    // What print gets: the host's print rule hides it (the paged view's hides the layer over its pages).
    const print = [...document.adoptedStyleSheets]
      .flatMap((s) => [...s.cssRules])
      .filter((r) => r instanceof CSSMediaRule && r.conditionText === "print")
      .map((r) => r.cssText)
      .join("\n");
    expect(print).toMatch(/\.typstream \.typstream-island\)?\s*\{\s*display: none;/);
  });
});
