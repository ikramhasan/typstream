// AI SDK messages as typstream documents (#34). An assistant message's text is
// the document; these read it from the SDK's UI messages without importing the
// SDK: the shapes below are the parts of `UIMessage` and `useChat()` they read,
// which are the same since AI SDK 5 (text parts with a `state`, a chat
// `status`). Tested against AI SDK 7.

/**
 * A part of an AI SDK `UIMessage`. Only text parts (`type: "text"`) are read;
 * reasoning, tool, file, source and data parts aren't the document.
 * @public
 */
export interface MessagePartLike {
  /** `"text"`, `"reasoning"`, `"tool-…"`, `"data-…"`, … */
  type: string;
  /** A text part's text so far. */
  text?: string;
  /** A text part's `"streaming"` or `"done"` (AI SDK 5 and later). */
  state?: string;
}

/**
 * What typstream reads of an AI SDK `UIMessage`.
 * @public
 */
export interface MessageLike {
  /** Unique in the chat: {@link isStreaming} compares it with the chat's last message. */
  id: string;
  /** `"user"`, `"assistant"` or `"system"`. */
  role: string;
  /** In the order they arrived. */
  parts: readonly MessagePartLike[];
}

/**
 * What typstream reads of a chat: `useChat()`'s result, or an AI SDK `Chat`.
 * @public
 */
export interface ChatLike {
  /** `"submitted"`, `"streaming"`, `"ready"` or `"error"`. */
  status: string;
  /** The conversation, oldest first; the answer being written is the last. */
  messages: readonly MessageLike[];
}

/**
 * The document a message holds: its text parts, joined. For `<Typstream source>`
 * or `mountTypstream`'s `source`.
 * @public
 */
export const textOf = (message: MessageLike): string => {
  let text = "";
  for (const part of message.parts) if (part.type === "text") text += part.text ?? "";
  return text;
};

/**
 * Whether more of the message's text is coming: it's the assistant message the
 * chat is answering with, and it doesn't end with a text part that has ended.
 * Before any text, while a text part streams, and after a tool call or other
 * part (a later step may write more), it's true. For `<Typstream isStreaming>`:
 * while true the document heals and shows a caret; once false it compiles in
 * final mode.
 *
 * A text part's own `state` isn't enough: when the answer stops early
 * (`stop()`, a network error), the SDK leaves it `"streaming"` and only the
 * chat's `status` changes. And `status` alone would mark every earlier answer
 * as streaming again whenever a new one streams.
 * @public
 */
export const isStreaming = (message: MessageLike, chat: ChatLike): boolean => {
  if (message.role !== "assistant" || (chat.status !== "streaming" && chat.status !== "submitted")) return false;
  if (chat.messages[chat.messages.length - 1]?.id !== message.id) return false;
  // Text that ended and was followed by a tool call may go on in the next step: only the
  // last part having ended as text says the answer's text is complete.
  const last = message.parts[message.parts.length - 1];
  return last?.type !== "text" || last.state !== "done";
};

/**
 * The text of a message as it streams, as chunks: what `mountTypstream`'s
 * `stream` (or `<Typstream stream>`) reads. `messages` are snapshots of one
 * message, such as AI SDK's `readUIMessageStream()` yields.
 *
 * @example
 * ```ts
 * import { DefaultChatTransport, readUIMessageStream } from "ai";
 *
 * const transport = new DefaultChatTransport({ api: "/api/chat" });
 * const chunks = await transport.sendMessages({
 *   chatId: "worksheet",
 *   messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "A worksheet on fractions" }] }],
 *   trigger: "submit-message",
 *   messageId: undefined,
 *   abortSignal: undefined,
 * });
 * mountTypstream(el, { engine, stream: textStream(readUIMessageStream({ stream: chunks })) });
 * ```
 * @public
 */
export async function* textStream(messages: AsyncIterable<MessageLike>): AsyncGenerator<string, void, undefined> {
  let sent = "";
  for await (const message of messages) {
    const text = textOf(message);
    if (text === sent) continue;
    // A message's text parts only grow, and new ones come after them.
    if (!text.startsWith(sent)) throw new Error("textStream: the message's text changed instead of growing");
    yield text.slice(sent.length);
    sent = text;
  }
}
