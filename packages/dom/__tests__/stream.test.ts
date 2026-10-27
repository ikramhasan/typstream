// subscribeStream (#81): one reader per stream, shared by the mounts given it.
// The browser tests check it through mountTypstream and <Typstream> in StrictMode.

import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeStream } from "../src/stream";

/** An async iterable whose chunks the test releases one by one, recording `return()`. */
const controlled = () => {
  const waiting: ((r: IteratorResult<string>) => void)[] = [];
  const queued: IteratorResult<string>[] = [];
  const log = { nexts: 0, returned: false };
  const iterator: AsyncIterator<string> = {
    next: () => {
      log.nexts++;
      const r = queued.shift();
      return r ? Promise.resolve(r) : new Promise((resolve) => waiting.push(resolve));
    },
    return: async () => {
      log.returned = true;
      return { done: true, value: undefined };
    },
  };
  const deliver = (r: IteratorResult<string>) => {
    const resolve = waiting.shift();
    if (resolve) resolve(r);
    else queued.push(r);
  };
  return {
    stream: { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<string>,
    log,
    send: (chunk: string) => deliver({ done: false, value: chunk }),
    end: () => deliver({ done: true, value: undefined }),
  };
};

/** Lets pending promise callbacks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.unstubAllGlobals());

describe("subscribeStream", () => {
  it("reads the stream once, and a later subscriber starts from the text read so far", async () => {
    const s = controlled();
    let calls = 0;
    const a = subscribeStream(s.stream, () => calls++);
    s.send("one ");
    await tick();
    expect(a.state).toMatchObject({ text: "one ", open: true });
    const b = subscribeStream(s.stream, () => {});
    expect(b.state.text).toBe("one ");
    s.send("two");
    s.end();
    await tick();
    expect(b.state).toBe(a.state);
    expect(b.state).toMatchObject({ text: "one two", open: false });
    expect(calls).toBe(3);
    // A single iterator, pulled once per chunk and once for the end.
    expect(s.log.nexts).toBe(3);
    expect(s.log.returned).toBe(false);
  });

  it("keeps reading when the last subscriber leaves and another joins before the next chunk (StrictMode)", async () => {
    const s = controlled();
    const first = subscribeStream(s.stream, () => {});
    s.send("a");
    await tick();
    first.stop();
    const second = subscribeStream(s.stream, () => {});
    s.send("b");
    s.end();
    await tick();
    expect(second.state).toMatchObject({ text: "ab", open: false });
    expect(s.log.returned).toBe(false);
  });

  it("closes the stream at the next chunk once nobody reads it, keeping that chunk", async () => {
    const s = controlled();
    const only = subscribeStream(s.stream, () => {});
    s.send("a");
    await tick();
    only.stop();
    s.send("b");
    await tick();
    expect(s.log.returned).toBe(true);
    const late = subscribeStream(s.stream, () => {});
    expect(late.state).toMatchObject({ text: "ab", open: false });
  });

  it("ends a failed stream with what arrived and reports the error once", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    async function* failing() {
      yield "partial";
      throw new Error("connection lost");
    }
    const stream = failing();
    const a = subscribeStream(stream, () => {});
    const b = subscribeStream(stream, () => {});
    await tick();
    expect(a.state).toMatchObject({ text: "partial", open: false });
    expect(b.state).toBe(a.state);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("reports an iterable that throws when asked for its iterator", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const broken = {
      [Symbol.asyncIterator]: () => {
        throw new Error("not iterable today");
      },
    } as AsyncIterable<string>;
    const a = subscribeStream(broken, () => {});
    await tick();
    expect(a.state.open).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
