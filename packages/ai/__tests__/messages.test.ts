import { describe, expect, it } from "vitest";
import { type ChatLike, isStreaming, type MessageLike, textOf, textStream } from "../src";

const assistant = (parts: MessageLike["parts"], id = "a1"): MessageLike => ({ id, role: "assistant", parts });
const user: MessageLike = { id: "u1", role: "user", parts: [{ type: "text", text: "A quiz on fractions" }] };
const chat = (status: string, ...messages: MessageLike[]): ChatLike => ({ status, messages: [user, ...messages] });

describe("textOf", () => {
  it("joins the text parts and skips the others", () => {
    const m = assistant([
      { type: "step-start" },
      { type: "reasoning", text: "The teacher wants…", state: "done" },
      { type: "text", text: "= Fractions\n\n", state: "done" },
      { type: "tool-search", state: "output-available" },
      { type: "data-progress" },
      { type: "text", text: "#question[½ + ¼]", state: "streaming" },
    ]);
    expect(textOf(m)).toBe("= Fractions\n\n#question[½ + ¼]");
  });

  it("is empty before any text", () => {
    expect(textOf(assistant([]))).toBe("");
    expect(textOf(assistant([{ type: "reasoning", text: "…", state: "streaming" }]))).toBe("");
  });
});

describe("isStreaming", () => {
  const writing = assistant([{ type: "text", text: "= Frac", state: "streaming" }]);
  const ended = assistant([{ type: "text", text: "= Fractions", state: "done" }]);

  it("is true for the answer being written", () => {
    expect(isStreaming(writing, chat("streaming", writing))).toBe(true);
  });

  it("is true before the answer's text starts", () => {
    const thinking = assistant([{ type: "reasoning", text: "…", state: "streaming" }]);
    expect(isStreaming(thinking, chat("streaming", thinking))).toBe(true);
    expect(isStreaming(assistant([]), chat("submitted", assistant([])))).toBe(true);
  });

  it("is false once every text part has ended, before the chat is ready", () => {
    expect(isStreaming(ended, chat("streaming", ended))).toBe(false);
  });

  it("is false when the chat stopped or failed, though the part still says streaming", () => {
    expect(isStreaming(writing, chat("ready", writing))).toBe(false);
    expect(isStreaming(writing, chat("error", writing))).toBe(false);
  });

  it("is false for earlier answers while a new one streams", () => {
    const next = assistant([{ type: "text", text: "= Dec", state: "streaming" }], "a2");
    const c = chat("streaming", writing, { ...user, id: "u2" }, next);
    expect(isStreaming(writing, c)).toBe(false);
    expect(isStreaming(next, c)).toBe(true);
  });

  it("is false for the user's message while the chat waits for an answer", () => {
    expect(isStreaming(user, chat("submitted"))).toBe(false);
  });

  it("falls back on the chat when parts have no state (stored or custom messages)", () => {
    const stateless = assistant([{ type: "text", text: "= Frac" }]);
    expect(isStreaming(stateless, chat("streaming", stateless))).toBe(true);
    expect(isStreaming(stateless, chat("ready", stateless))).toBe(false);
  });
});

describe("textStream", () => {
  const snapshots = async function* (...texts: string[][]) {
    for (const parts of texts) yield assistant(parts.map((text) => ({ type: "text", text })));
  };

  it("yields what each snapshot adds", async () => {
    const chunks: string[] = [];
    for await (const c of textStream(snapshots([], ["= A"], ["= A"], ["= Ab"], ["= Abc", ""], ["= Abc", "\n\nx"]))) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["= A", "b", "c", "\n\nx"]);
  });

  it("throws when the text changes instead of growing", async () => {
    const read = async () => {
      for await (const _ of textStream(snapshots(["= A"], ["= B"])));
    };
    await expect(read()).rejects.toThrow(/changed instead of growing/);
  });
});
