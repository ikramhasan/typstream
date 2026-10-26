/// <reference lib="dom" />
// <Typstream> in each browser, with React Testing Library and the real engine
// worker: streaming a growing `source` and a `stream`, both targets, the
// provider's settings, useTypstream(), StrictMode, lazy opening offscreen, and
// cleanup (documents on unmount, the shared worker after its last user).

import { cleanup, render, waitFor } from "@testing-library/react";
import type { Diagnostic } from "@typstream/core";
import type { DocumentStatus, Engine, EngineDocument } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { createRef, StrictMode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { defaultEngineForTests, RELEASE_DELAY } from "../../src/engine";
import { Typstream, type TypstreamHandle, type TypstreamProps, TypstreamProvider, useTypstream } from "../../src/index";
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
});
