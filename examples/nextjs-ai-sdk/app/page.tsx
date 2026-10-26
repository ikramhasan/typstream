"use client";
// A chat whose answers are Typst documents: useChat streams the model's text
// parts, and each part renders as a <Typstream>. It heals every prefix so it
// compiles, keeps the last good render while one doesn't, and finishes the
// document (strict compile, no caret) once the answer is complete. All answers
// share one engine worker; only visible or streaming ones compile.

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { Typstream, useTypstream } from "typstream";

type Target = "html" | "paged";

const Answer = ({ text, streaming, target }: { text: string; streaming: boolean; target: Target }) => {
  const t = useTypstream();
  // Compiles that failed while streaming. The last good render stays on screen, so a reader never
  // sees them; the smoke test checks there were none.
  const [stale, setStale] = useState(0);
  const frame = t.openFrames[0]?.frame;
  return (
    <article className="answer" data-status={t.status} data-stale={stale} data-target={target}>
      <Typstream
        ref={t.ref}
        source={text}
        isStreaming={streaming}
        target={target}
        layout="fit-width"
        animated
        caret
        onStatusChange={(status) => {
          if (status === "stale" || status === "error") setStale((n) => n + 1);
        }}
      />
      <footer>
        {t.status}
        {streaming && frame ? ` · writing a ${frame}…` : ""}
        {t.diagnostics.length ? ` · ${t.diagnostics.length} diagnostics` : ""}
      </footer>
    </article>
  );
};

export default function Page() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("A one-page worksheet on the Pythagorean theorem for grade 8");
  const [target, setTarget] = useState<Target>("html");
  const last = messages[messages.length - 1];

  return (
    <main>
      <h1>typstream × AI SDK</h1>
      <label>
        Render as{" "}
        <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          <option value="html">HTML</option>
          <option value="paged">pages</option>
        </select>
      </label>
      {messages.map((message) =>
        message.parts.map((part, i) =>
          part.type !== "text" ? null : message.role === "user" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never reorder.
            <p key={`${message.id}-${i}`} className="user">
              {part.text}
            </p>
          ) : (
            <Answer
              // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never reorder.
              key={`${message.id}-${i}`}
              text={part.text}
              streaming={status === "streaming" && message.id === last?.id}
              target={target}
            />
          ),
        ),
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status === "streaming" || status === "submitted") return;
          void sendMessage({ text: input });
          setInput("");
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask for a worksheet…" />
        <button type="submit" disabled={status === "streaming" || status === "submitted"}>
          Send
        </button>
      </form>
    </main>
  );
}
