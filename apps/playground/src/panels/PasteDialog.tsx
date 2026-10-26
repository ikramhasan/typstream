import { useState } from "react";
import { looksLikeStream } from "../stream";
import { Dialog } from "./Dialog";

interface Props {
  onClose: () => void;
  onLoad: (text: string) => void;
}

export const PasteDialog = ({ onClose, onLoad }: Props) => {
  const [text, setText] = useState("");
  const isStream = looksLikeStream(text);
  return (
    <Dialog title="Paste a document or a stream" onClose={onClose}>
      <p className="hint">
        A Typst document is cut into a synthetic token stream (seeded). A <code>.stream.jsonl</code> (one{" "}
        <code>{'{"t": ms, "text": "..."}'}</code> per line) is replayed as recorded.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="= Worksheet&#10;#table(columns: 2, [a], [b])"
        spellCheck={false}
      />
      <footer>
        <span className="hint">
          {text ? (isStream ? "Detected: stream (.jsonl)" : "Detected: Typst document") : ""}
        </span>
        <button type="button" className="primary" disabled={!text} onClick={() => onLoad(text)}>
          Load
        </button>
      </footer>
    </Dialog>
  );
};
