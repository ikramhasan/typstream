// The helpers against AI SDK 7 itself: recorded model streams (corpus/llm, with
// the API's own chunk boundaries) sent as UI message streams, read back by the
// SDK's reader, its HTTP transport and its Chat, including the ways an answer
// ends early.
import { ALL_SETS, type CorpusEntry, joinStream, loadCorpus } from "@typstream/corpus";
import {
  AbstractChat,
  type ChatState,
  type ChatStatus,
  type ChatTransport,
  createUIMessageStream,
  createUIMessageStreamResponse,
  DefaultChatTransport,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { describe, expect, it } from "vitest";
import { type ChatLike, isStreaming, type MessageLike, textOf, textStream } from "../src";

const recorded = loadCorpus({ sets: ALL_SETS }).filter(
  (e): e is CorpusEntry & { recordedStream: NonNullable<CorpusEntry["recordedStream"]> } =>
    e.set === "llm" && e.name.startsWith("kit-v4-") && e.recordedStream !== undefined,
);

const textOfEntry = (entry: (typeof recorded)[number]) => joinStream(entry.recordedStream);

/**
 * The answer as a server sends it: some reasoning, then the recorded text deltas. `pause(i)` runs
 * before delta `i`; `failAt` errors the stream there instead.
 */
const answer = (
  entry: (typeof recorded)[number],
  options: { pause?: (i: number) => Promise<void>; failAt?: number } = {},
): ReadableStream<UIMessageChunk> =>
  createUIMessageStream({
    async execute({ writer }) {
      writer.write({ type: "reasoning-start", id: "r" });
      writer.write({ type: "reasoning-delta", id: "r", delta: "A worksheet with an answer key." });
      writer.write({ type: "reasoning-end", id: "r" });
      writer.write({ type: "text-start", id: "t" });
      for (const [i, chunk] of entry.recordedStream.entries()) {
        await options.pause?.(i);
        if (i === options.failAt) throw new Error("upstream failed");
        writer.write({ type: "text-delta", id: "t", delta: chunk.text });
      }
      writer.write({ type: "text-end", id: "t" });
    },
  });

it("has recorded streams to replay", () => {
  expect(recorded.length).toBeGreaterThanOrEqual(20);
});

describe("readUIMessageStream → textStream", () => {
  it.each(recorded.map((e) => [e.name, e] as const))("%s", async (_, entry) => {
    const chunks: string[] = [];
    for await (const chunk of textStream(readUIMessageStream({ stream: answer(entry) }))) chunks.push(chunk);
    expect(chunks.join("")).toBe(textOfEntry(entry));
    // As the model sent it, not in one piece at the end.
    expect(chunks).toEqual(entry.recordedStream.map((c) => c.text).filter(Boolean));
  });
});

describe("DefaultChatTransport (the UI message stream over HTTP) → textStream", () => {
  // Arabic and Bengali text, math, and the longest recording.
  const picks = [
    ...recorded.filter((e) => /arabic|bengali|bangla/.test(e.name)).slice(0, 2),
    [...recorded].sort((a, b) => textOfEntry(b).length - textOfEntry(a).length)[0] as (typeof recorded)[number],
  ];

  it.each(picks.map((e) => [e.name, e] as const))("%s", async (_, entry) => {
    const transport = new DefaultChatTransport<UIMessage>({
      api: "https://example.test/api/chat",
      fetch: async () => createUIMessageStreamResponse({ stream: answer(entry) }),
    });
    const stream = await transport.sendMessages({
      chatId: "c",
      messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "A worksheet" }] }],
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: undefined,
    });
    let text = "";
    for await (const chunk of textStream(readUIMessageStream({ stream }))) text += chunk;
    expect(text).toBe(textOfEntry(entry));
  });
});

// --- A Chat, as useChat runs one -------------------------------------------------------------

interface Seen {
  status: ChatStatus;
  text: string;
  streaming: boolean;
  /** The text part's own state. */
  partState: string | undefined;
}

/** A Chat whose state records, at every change, what the app would render for the last answer. */
class TestChat extends AbstractChat<UIMessage> {
  readonly seen: Seen[] = [];

  constructor(transport: ChatTransport<UIMessage>) {
    let status: ChatStatus = "ready";
    let messages: UIMessage[] = [];
    const record = () => this.record();
    const state: ChatState<UIMessage> = {
      get status() {
        return status;
      },
      set status(s) {
        status = s;
        record();
      },
      error: undefined,
      get messages() {
        return messages;
      },
      set messages(m) {
        messages = m;
        record();
      },
      pushMessage: (m) => {
        messages = [...messages, m];
        record();
      },
      popMessage: () => {
        messages = messages.slice(0, -1);
        record();
      },
      replaceMessage: (i, m) => {
        messages = messages.map((old, j) => (j === i ? m : old));
        record();
      },
      snapshot: (thing) => structuredClone(thing),
    };
    super({ transport, state });
  }

  private record(): void {
    // The constructor's state calls this before `seen` exists.
    if (!this.seen) return;
    const last = this.messages.at(-1);
    if (last?.role !== "assistant") return;
    const part = last.parts.find((p) => p.type === "text");
    this.seen.push({
      status: this.status,
      text: textOf(last),
      streaming: isStreaming(last, this),
      partState: part?.type === "text" ? part.state : undefined,
    });
  }
}

const transportOf = (stream: () => ReadableStream<UIMessageChunk>): ChatTransport<UIMessage> => ({
  sendMessages: async () => stream(),
  reconnectToStream: async () => null,
});

/**
 * A `pause` for {@link answer} that lets deltas before `at` through and holds the stream from
 * there on (until the chat stops it); `reached` resolves once it holds.
 */
const holdAt = (at: number) => {
  let open: () => void = () => {};
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  const pause = (i: number): Promise<void> => {
    if (i < at) return Promise.resolve();
    open();
    return new Promise(() => {});
  };
  return { reached, pause };
};

describe("Chat", () => {
  const entry = recorded.find((e) => e.recordedStream.length > 40) as (typeof recorded)[number];

  it("streams the answer, then finishes it before the chat is ready", async () => {
    const chat = new TestChat(transportOf(() => answer(entry)));
    await chat.sendMessage({ text: "A worksheet" });
    const last = chat.messages.at(-1) as UIMessage;
    expect(textOf(last)).toBe(textOfEntry(entry));
    expect(isStreaming(last, chat)).toBe(false);

    const streamingTexts = chat.seen.filter((s) => s.streaming).map((s) => s.text);
    expect(streamingTexts.length).toBeGreaterThan(entry.recordedStream.length / 2);
    // Every streamed text extends the previous one: a `source` that grows (push, not set).
    for (const [i, text] of streamingTexts.entries()) expect(text.startsWith(streamingTexts[i - 1] ?? "")).toBe(true);
    // Final mode starts at text-end, while the chat still says `streaming`.
    const first = chat.seen.findIndex((s) => s.partState === "done");
    expect(chat.seen[first]).toMatchObject({ status: "streaming", streaming: false, text: textOfEntry(entry) });
    expect(chat.seen.slice(first).every((s) => !s.streaming)).toBe(true);
  });

  it("stop(): the part stays `streaming` but the answer is finished, with what arrived", async () => {
    const half = Math.floor(entry.recordedStream.length / 2);
    const hold = holdAt(half);
    const chat = new TestChat(transportOf(() => answer(entry, { pause: hold.pause })));
    const sent = chat.sendMessage({ text: "A worksheet" });
    await hold.reached;
    // The stream's chunks are processed in order; wait for the ones before the pause.
    await expect
      .poll(() => textOf(chat.messages.at(-1) as UIMessage))
      .toBe(joinStream(entry.recordedStream.slice(0, half)));
    expect(isStreaming(chat.messages.at(-1) as UIMessage, chat)).toBe(true);
    await chat.stop();
    await sent;

    const last = chat.messages.at(-1) as UIMessage;
    expect(chat.status).toBe("ready");
    expect(last.parts.find((p) => p.type === "text")).toMatchObject({ state: "streaming" });
    expect(isStreaming(last, chat)).toBe(false);
    expect(textOf(last)).toBe(joinStream(entry.recordedStream.slice(0, half)));
  });

  it("a failed stream: the answer is finished, with what arrived", async () => {
    const failAt = Math.floor(entry.recordedStream.length / 3);
    const chat = new TestChat(transportOf(() => answer(entry, { failAt })));
    await chat.sendMessage({ text: "A worksheet" });

    const last = chat.messages.at(-1) as UIMessage;
    expect(chat.status).toBe("error");
    expect(isStreaming(last, chat)).toBe(false);
    expect(textOf(last)).toBe(joinStream(entry.recordedStream.slice(0, failAt)));
  });

  it("an earlier answer stays finished while the next one streams", async () => {
    const hold = holdAt(10);
    let request = 0;
    const chat = new TestChat(
      transportOf(() => (++request === 1 ? answer(entry, { failAt: 10 }) : answer(entry, { pause: hold.pause }))),
    );
    await chat.sendMessage({ text: "A worksheet" });
    const first = chat.messages.at(-1) as UIMessage;
    const sent = chat.sendMessage({ text: "Another" });
    await hold.reached;
    await expect.poll(() => textOf(chat.messages.at(-1) as UIMessage).length).toBeGreaterThan(0);

    expect(first.parts.find((p) => p.type === "text")).toMatchObject({ state: "streaming" });
    expect(isStreaming(first, chat)).toBe(false);
    expect(isStreaming(chat.messages.at(-1) as UIMessage, chat)).toBe(true);
    await chat.stop();
    await sent;
  });
});

// AI SDK's own types fit the shapes typstream reads (checked by check-types).
const _message = (m: UIMessage): MessageLike => m;
const _chat = (c: AbstractChat<UIMessage>): ChatLike => c;
