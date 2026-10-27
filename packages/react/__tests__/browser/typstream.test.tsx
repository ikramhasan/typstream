/// <reference lib="dom" />
// <Typstream> in each browser, with React Testing Library and the real engine
// worker: streaming a growing `source` and a `stream`, both targets, the
// provider's settings, useTypstream(), StrictMode, lazy opening offscreen,
// cleanup (documents on unmount, the shared worker after its last user), and
// exports (#18) from the handle and the hook.

import { cleanup, render, waitFor } from "@testing-library/react";
import type { Diagnostic, FallbackEvent, RenderedEvent } from "@typstream/core";
import type { DocumentStatus, Engine, EngineDocument } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { createRef, StrictMode, useEffect } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { defaultEngineForTests, RELEASE_DELAY } from "../../src/engine";
import {
  Typstream,
  type TypstreamHandle,
  type TypstreamInfo,
  type TypstreamProps,
  TypstreamProvider,
  useTypstream,
} from "../../src/index";
import { FIVE_PAGES, sleep, startEngine, tokens, workers } from "../support/engine";

const browser = server.browser;
const LONG = { timeout: 60_000 };

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());
afterEach(cleanup);

/** An engine whose documents record whether they were disposed. */
const tracked = (base: Engine) => {
  const docs: { doc: EngineDocument; disposed: boolean }[] = [];
  const engine = new Proxy(base, {
    get(target, prop) {
      if (prop === "open") {
        return (options: Parameters<Engine["open"]>[0]) => {
          const doc = target.open(options);
          const record = { doc, disposed: false };
          const dispose = doc.dispose.bind(doc);
          doc.dispose = () => {
            record.disposed = true;
            dispose();
          };
          docs.push(record);
          return doc;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { engine, docs };
};

/** A PDF's first page size in points, from its MediaBox. */
const mediaBox = (pdf: Uint8Array): number[] => {
  const text = new TextDecoder("latin1").decode(pdf);
  expect(text.startsWith("%PDF-")).toBe(true);
  return (/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(text) ?? []).slice(1).map(Number);
};

/** Records what a <Typstream> reports through its callbacks. */
const recorder = () => {
  const statuses: DocumentStatus[] = [];
  const errors: Diagnostic[] = [];
  const props: Pick<TypstreamProps, "onStatusChange" | "onDiagnostics"> = {
    onStatusChange: (status) => statuses.push(status),
    onDiagnostics: (diagnostics) => errors.push(...diagnostics.filter((d) => d.severity === "error")),
  };
  return { statuses, errors, props, last: () => statuses[statuses.length - 1] };
};

describe(`<Typstream> in ${browser}`, () => {
  it("streams a growing source into HTML with no error frames", async () => {
    const r = recorder();
    const view = (source: string, isStreaming: boolean) => (
      <Typstream engine={engine} source={source} isStreaming={isStreaming} animated caret {...r.props} />
    );
    const { container, rerender } = render(view("", true));
    const chunks = tokens(FIVE_PAGES);
    let text = "";
    for (let i = 0; i < chunks.length; i++) {
      text += chunks[i];
      // A few tokens per render, as a chat UI re-renders per network chunk.
      if (i % 6 === 5) {
        rerender(view(text, true));
        await sleep(1);
      }
    }
    // A caret while streaming.
    await waitFor(() => expect(container.querySelector(".typstream-caret")).not.toBeNull(), LONG);
    rerender(view(text, false));
    await waitFor(() => expect(r.last()).toBe("done"), LONG);
    expect(r.statuses).not.toContain("stale");
    expect(r.statuses).not.toContain("error");
    expect(r.errors).toEqual([]);
    const root = container.querySelector(".typstream");
    expect(root?.textContent).toContain("A five page handout");
    expect(root?.textContent).toContain("Section 11");
    // No caret once the document is complete.
    expect(container.querySelector(".typstream-caret")).toBeNull();
  }, 120_000);

  it("reads a stream of chunks and finishes when it ends", async () => {
    const { chunks } = await commands.recordedStream();
    async function* chunked() {
      for (const chunk of chunks) {
        yield chunk;
        await sleep(0);
      }
    }
    const stream = chunked();
    const r = recorder();
    const { container } = render(<Typstream engine={engine} stream={stream} {...r.props} />);
    await waitFor(() => expect(r.last()).toBe("done"), LONG);
    expect(container.textContent).toContain("best answer for each question.");
    expect(container.textContent).toContain("What is the longest river in Africa?");
  }, 120_000);

  it("renders pages, and switches targets on the same document", async () => {
    const { engine: spy, docs } = tracked(engine);
    const r = recorder();
    const { container, rerender } = render(
      <Typstream engine={spy} target="paged" source={FIVE_PAGES} textLayer={false} {...r.props} />,
    );
    await waitFor(() => expect(container.querySelectorAll(".typstream-page").length).toBeGreaterThanOrEqual(5), LONG);
    expect(r.last()).toBe("done");
    rerender(<Typstream engine={spy} target="html" source={FIVE_PAGES} {...r.props} />);
    await waitFor(() => expect(container.querySelector(".typstream")?.textContent).toContain("Section 11"), LONG);
    expect(container.querySelector(".typstream-paged")).toBeNull();
    expect(docs).toHaveLength(1);
  }, 120_000);

  it("takes settings from the provider", async () => {
    const r = recorder();
    const { container } = render(
      <TypstreamProvider engine={engine} plugins={[htmlCompat]} stylesheets={[htmlCompatCss]} theme="dark">
        <Typstream source={"#grid(columns: 2)[left][right]"} {...r.props} />
      </TypstreamProvider>,
    );
    await waitFor(() => expect(r.last()).toBe("done"), LONG);
    const root = container.querySelector(".typstream");
    expect(root?.getAttribute("data-typstream-theme")).toBe("dark");
    // html-compat keeps the grid's content (plain HTML export drops it).
    expect(root?.textContent).toContain("left");
    expect(root?.textContent).toContain("right");
  }, 60_000);

  it("calls the provider's telemetry hooks and the instance's", async () => {
    const app: RenderedEvent[] = [];
    const own: RenderedEvent[] = [];
    const fallbacks: FallbackEvent[] = [];
    const source = "= Quiz\n\nGood.\n\n#nope\n";
    render(
      <TypstreamProvider engine={engine} onRendered={(e) => app.push(e)} onFallback={(e) => fallbacks.push(e)}>
        <Typstream source={source} onRendered={(e) => own.push(e)} />
      </TypstreamProvider>,
    );
    await waitFor(() => expect(fallbacks).toHaveLength(1), LONG);
    await waitFor(() => expect(own.at(-1)?.fallbackLevel).toBe(3), LONG);
    expect(app).toEqual(own);
    expect(fallbacks[0]).toMatchObject({ level: 3, mode: "final", source });
  }, 60_000);

  it("reports status, healed source and open frames through useTypstream()", async () => {
    const Harness = ({ source, isStreaming }: { source: string; isStreaming: boolean }) => {
      const t = useTypstream();
      return (
        <>
          <Typstream ref={t.ref} engine={engine} source={source} isStreaming={isStreaming} />
          <output data-testid="status">{t.status}</output>
          <output data-testid="healed">{t.healedSource}</output>
          <output data-testid="frames">{t.openFrames.length}</output>
        </>
      );
    };
    const { getByTestId, rerender } = render(<Harness source={"#table(columns: 2, [a], [b"} isStreaming />);
    await waitFor(() => expect(Number(getByTestId("frames").textContent)).toBeGreaterThan(0), LONG);
    expect(getByTestId("healed").textContent).toMatch(/^#table\(columns: 2, \[a\], \[b.*\]\)$/);
    rerender(<Harness source={"#table(columns: 2, [a], [b])"} isStreaming={false} />);
    await waitFor(() => expect(getByTestId("status").textContent).toBe("done"), LONG);
    expect(getByTestId("frames").textContent).toBe("0");
  }, 60_000);

  it("is StrictMode-safe: one document stays open, the first mount's is disposed", async () => {
    const { engine: spy, docs } = tracked(engine);
    const r = recorder();
    const { container, unmount } = render(
      <StrictMode>
        <Typstream engine={spy} source={"= Strict"} {...r.props} />
      </StrictMode>,
    );
    await waitFor(() => expect(r.last()).toBe("done"), LONG);
    expect(container.querySelectorAll(".typstream")).toHaveLength(1);
    expect(docs.filter((d) => !d.disposed)).toHaveLength(1);
    unmount();
    expect(docs.every((d) => d.disposed)).toBe(true);
  }, 60_000);

  it("is StrictMode-safe with a stream: the document ends with every chunk", async () => {
    const { chunks } = await commands.recordedStream();
    async function* chunked() {
      for (const chunk of chunks) {
        await sleep(1);
        yield chunk;
      }
    }
    const stream = chunked();
    const handle = createRef<TypstreamHandle>();
    const r = recorder();
    render(
      <StrictMode>
        <Typstream ref={handle} engine={engine} stream={stream} {...r.props} />
      </StrictMode>,
    );
    await waitFor(() => expect(r.last()).toBe("done"), LONG);
    expect(handle.current?.document?.exportSource()).toBe(chunks.join(""));
  }, 120_000);

  it("opens a document offscreen only once it nears the viewport, unless it is streaming", async () => {
    const lazy = createRef<TypstreamHandle>();
    const streaming = createRef<TypstreamHandle>();
    const { container } = render(
      <>
        <div style={{ height: "400vh" }} />
        <Typstream ref={streaming} engine={engine} source={"= Streaming"} isStreaming />
        <Typstream ref={lazy} engine={engine} source={"= Far away"} />
      </>,
    );
    await waitFor(() => expect(streaming.current?.document).not.toBeNull(), LONG);
    await sleep(300);
    expect(lazy.current?.document).toBeNull();
    lazy.current?.element?.scrollIntoView();
    await waitFor(() => expect(lazy.current?.getState()?.status).toBe("done"), LONG);
    expect(container.textContent).toContain("Far away");
    window.scrollTo(0, 0);
  }, 60_000);

  it("shares one worker among instances without an engine, and terminates it after the last unmounts", async () => {
    defaultEngineForTests.setFactory(startEngine);
    const spawned = workers.spawned;
    const terminated = workers.terminated;
    const handles = [createRef<TypstreamHandle>(), createRef<TypstreamHandle>()];
    const { unmount } = render(
      <>
        <Typstream ref={handles[0]} source={"= One"} lazy={false} />
        <Typstream ref={handles[1]} source={"= Two"} lazy={false} />
      </>,
    );
    await waitFor(() => expect(handles.map((h) => h.current?.getState()?.status)).toEqual(["done", "done"]), LONG);
    expect(workers.spawned - spawned).toBe(1);
    expect(defaultEngineForTests.users()).toBe(2);
    unmount();
    expect(defaultEngineForTests.users()).toBe(0);
    await sleep(RELEASE_DELAY + 200);
    expect(workers.terminated - terminated).toBe(1);
    expect(defaultEngineForTests.current()).toBeNull();
  }, 60_000);

  describe("exports", () => {
    /** Renders a <Typstream> with useTypstream() and hands the hook's result out. */
    const withHook = (props: Omit<TypstreamProps, "ref">) => {
      const info: { current: TypstreamInfo | null } = { current: null };
      const Harness = (p: Omit<TypstreamProps, "ref">) => {
        const t = useTypstream();
        info.current = t;
        return <Typstream ref={t.ref} {...p} />;
      };
      const result = render(<Harness {...props} />);
      return {
        ...result,
        info,
        rerender: (next: Omit<TypstreamProps, "ref">) => result.rerender(<Harness {...next} />),
      };
    };

    it("exports a PDF at the document's own page size from a fit-width preview", async () => {
      const r = recorder();
      const { info } = withHook({
        engine,
        source: "= Worksheet\nSolve $x^2 = 4$.",
        target: "paged",
        layout: "fit-width",
        style: { width: "300px" },
        lazy: false,
        ...r.props,
      });
      await waitFor(() => expect(info.current?.state?.artifact?.target).toBe("paged"), LONG);
      await waitFor(() => expect(r.last()).toBe("done"), LONG);
      const shown = info.current?.state?.artifact;
      // The preview is as wide as the element (300 px = 225 pt)…
      expect(shown?.target === "paged" && shown.pages[0]?.width).toBeCloseTo(225, 0);
      // …and the PDF, from the hook and from the handle, is A4, Typst's default.
      const [width, height] = mediaBox(await (info.current as TypstreamInfo).exportPdf());
      expect(width).toBeCloseTo(595.28, 1);
      expect(height).toBeCloseTo(841.89, 1);
      expect(mediaBox(await (info.current?.handle as TypstreamHandle).exportPdf())).toEqual([width, height]);
      // `document`'s own export compiles with the preview's inputs, fit-width's width included.
      const [previewWidth] = mediaBox(await (info.current?.document as EngineDocument).exportPdf());
      expect(previewWidth).toBeCloseTo(225, 0);
    }, 60_000);

    it("exports with the inputs passed as props, and an export's own over them", async () => {
      const r = recorder();
      const source = '#set page(width: float(sys.inputs.at("width", default: "100")) * 1pt, height: 200pt)\nHi';
      const { info, rerender } = withHook({ engine, source, inputs: { width: "300" }, lazy: false, ...r.props });
      await waitFor(() => expect(r.last()).toBe("done"), LONG);
      const size = async () => mediaBox(await (info.current as TypstreamInfo).exportPdf());
      expect((await size())[0]).toBeCloseTo(300, 1);
      rerender({ engine, source, inputs: { width: "400" }, lazy: false, ...r.props });
      const [width, height] = await size();
      expect(width).toBeCloseTo(400, 1);
      expect(height).toBeCloseTo(200, 1);
      // A teacher's copy: inputs for one export, over the props'.
      const t = info.current as TypstreamInfo;
      expect(mediaBox(await t.exportPdf({ inputs: { width: "500" } }))[0]).toBeCloseTo(500, 1);
      expect(mediaBox(await (t.handle as TypstreamHandle).exportPdf({ inputs: { width: "450" } }))[0]).toBeCloseTo(
        450,
        1,
      );
      expect((await size())[0]).toBeCloseTo(400, 1);
      const source2 = '#sys.inputs.at("copy", default: "none")';
      rerender({ engine, source: source2, inputs: { copy: "student" }, lazy: false, ...r.props });
      expect(await t.exportHtml({ inputs: { copy: "teacher" } })).toContain("teacher");
      expect(await (info.current as TypstreamInfo).exportHtml()).toContain("student");
    }, 60_000);

    it("exports a standalone HTML file with the component's stylesheets and theme", async () => {
      const r = recorder();
      const { info } = withHook({
        engine,
        source: "= Worksheet\nSolve $x^2 = 4$.",
        stylesheets: [".marker { color: red }"],
        theme: "dark",
        ...r.props,
      });
      await waitFor(() => expect(r.last()).toBe("done"), LONG);
      const file = await (info.current as TypstreamInfo).exportHtml({ title: "Worksheet" });
      expect(file).toMatch(/^<!DOCTYPE html>/i);
      expect(file).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(file).toContain("<title>Worksheet</title>");
      expect(file).toContain(".marker { color: red }");
      expect(file).toContain('data-typstream-theme="dark"');
      expect(file).toContain("<h2>Worksheet</h2>");
    }, 60_000);

    it("exports the healed source", async () => {
      const r = recorder();
      const { info } = withHook({ engine, source: "#table(columns: 2, [a], [b", isStreaming: true, ...r.props });
      await waitFor(() => expect(info.current?.healedSource).not.toBe(""), LONG);
      const t = info.current as TypstreamInfo;
      expect(t.exportSource()).toMatch(/^#table\(columns: 2, \[a\], \[b.*\]\)$/);
      expect(t.exportSource()).toBe(t.healedSource);
    }, 60_000);

    it("opens a lazy document that hasn't opened yet to export it", async () => {
      const { info } = withHook({ engine, source: "= Far below", style: { marginTop: "400vh" } });
      await waitFor(() => expect(info.current?.handle).not.toBeNull(), LONG);
      await sleep(300);
      const t = info.current as TypstreamInfo;
      expect(t.handle?.document).toBeNull();
      expect(t.document).toBeNull();
      expect(mediaBox(await t.exportPdf())).toHaveLength(2);
      expect(t.handle?.document).not.toBeNull();
      expect(t.exportSource()).toBe("= Far below");
    }, 60_000);

    it("fails clearly before the component mounts and after it unmounts", async () => {
      // A hook whose ref no <Typstream> received.
      const info: { current: TypstreamInfo | null } = { current: null };
      const Lonely = () => {
        info.current = useTypstream();
        return null;
      };
      render(<Lonely />);
      const lonely = info.current as unknown as TypstreamInfo;
      await expect(lonely.exportPdf()).rejects.toThrow("<Typstream> isn't mounted");
      await expect(lonely.exportHtml()).rejects.toThrow("<Typstream> isn't mounted");
      expect(() => lonely.exportSource()).toThrow("<Typstream> isn't mounted");

      // Exports started in the parent's effects: the first render's runs before the ref has the instance.
      const early: Promise<Uint8Array | Error>[] = [];
      const Eager = () => {
        const t = useTypstream();
        useEffect(() => {
          early.push(t.exportPdf().catch((error: Error) => error));
        }, [t]);
        return <Typstream ref={t.ref} engine={engine} source="= Eager" lazy={false} />;
      };
      const eager = render(<Eager />);
      await waitFor(() => expect(early.length).toBeGreaterThan(1), LONG);
      expect(await early[0]).toEqual(new Error("<Typstream> isn't mounted"));
      // Once the ref has the instance, the next render's export works.
      expect(mediaBox((await early.at(-1)) as Uint8Array)).toHaveLength(2);
      eager.unmount();

      const handle = createRef<TypstreamHandle>();
      const r = recorder();
      const { unmount } = render(<Typstream ref={handle} engine={engine} source="= Gone" {...r.props} />);
      await waitFor(() => expect(r.last()).toBe("done"), LONG);
      const instance = handle.current as TypstreamHandle;
      unmount();
      await expect(instance.exportPdf()).rejects.toThrow("<Typstream> isn't mounted");
      await expect(instance.exportHtml()).rejects.toThrow("<Typstream> isn't mounted");
      expect(() => instance.exportSource()).toThrow("<Typstream> isn't mounted");
    }, 60_000);
  });
});
