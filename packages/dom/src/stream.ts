// One reader per `stream` (#81), shared by every mount given it. An async
// generator is its own iterator, so mounts that each called
// `[Symbol.asyncIterator]()` pulled chunks from one generator in turns: under
// React StrictMode (mount, destroy, mount again with the same props) the
// first mount's pending `next()` took a chunk the second never saw, and its
// `return()` closed the generator under the second. Here the stream is read
// once into a buffer, and a mount subscribes to it: it starts from all the text
// read so far, whenever it mounts.

/** A stream's text as read so far. */
export interface StreamText {
  /** Everything read so far. */
  readonly text: string;
  /** False once the stream has ended (or failed, or was closed). */
  readonly open: boolean;
}

interface Shared extends StreamText {
  text: string;
  open: boolean;
  listeners: Set<() => void>;
}

// Keyed weakly: the buffer lives as long as the app keeps the stream.
const streams = new WeakMap<AsyncIterable<string>, Shared>();

const pull = async (source: AsyncIterable<string>, shared: Shared) => {
  const notify = () => {
    for (const listener of [...shared.listeners]) listener();
  };
  try {
    const iterator = source[Symbol.asyncIterator]();
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      shared.text += next.value;
      // Nobody reads it any more: release it (a network response, say). Kept
      // until a chunk arrives, so a mount replaced synchronously (StrictMode)
      // finds it still open.
      if (shared.listeners.size === 0) {
        await iterator.return?.();
        break;
      }
      notify();
    }
  } catch (error) {
    // The stream failed: what arrived stays, it ends, and the app hears of it (once, not per mount).
    if (shared.listeners.size) globalThis.reportError?.(error);
  }
  shared.open = false;
  notify();
};

/**
 * Reads `source`, or joins the reader already reading it. `listener` is called
 * after each chunk and when the stream ends; `stop()` unsubscribes it.
 */
export const subscribeStream = (
  source: AsyncIterable<string>,
  listener: () => void,
): { state: StreamText; stop: () => void } => {
  let shared = streams.get(source);
  const start = !shared;
  if (!shared) {
    shared = { text: "", open: true, listeners: new Set() };
    streams.set(source, shared);
  }
  const { listeners } = shared;
  // A Set would merge two subscriptions of one listener; a wrapper keeps them apart.
  const entry = () => listener();
  listeners.add(entry);
  // After subscribing, so an iterable that throws right away is reported.
  if (start) void pull(source, shared);
  return { state: shared, stop: () => listeners.delete(entry) };
};
