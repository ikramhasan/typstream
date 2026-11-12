// Replays a worksheet the way a model streams it: a fixed Typst document, a few
// characters every 30 ms, `isStreaming` until the last one. In an app, `source`
// is the text a model has written so far (apps/website/content/docs/getting-started/react.mdx).

import { useEffect, useState } from "react";
import { Typstream, useTypstream } from "typstream";
import WORKSHEET from "./worksheet.typ?raw";

type Target = "html" | "paged";

/** Characters per tick and the tick, in ms: about two seconds for the worksheet. */
const CHUNK = 6;
const TICK = 30;

export function App() {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<Target>("html");
  const [run, setRun] = useState(0);
  const t = useTypstream();
  const streaming = source.length < WORKSHEET.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` restarts the replay.
  useEffect(() => {
    let length = 0;
    setSource("");
    const timer = setInterval(() => {
      length = Math.min(length + CHUNK, WORKSHEET.length);
      setSource(WORKSHEET.slice(0, length));
      if (length === WORKSHEET.length) clearInterval(timer);
    }, TICK);
    return () => clearInterval(timer);
  }, [run]);

  async function downloadPdf() {
    const pdf = await t.exportPdf();
    const url = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "worksheet.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <h1>typstream with Vite and React</h1>
      <div className="toolbar">
        <label>
          <input type="radio" checked={target === "html"} onChange={() => setTarget("html")} /> HTML
        </label>
        <label>
          <input type="radio" checked={target === "paged"} onChange={() => setTarget("paged")} /> Pages
        </label>
        <button type="button" onClick={() => setRun((n) => n + 1)}>
          Replay
        </button>
        <button type="button" disabled={streaming} onClick={downloadPdf}>
          Download PDF
        </button>
        {/* `data-*` for smoke.mjs: whether the replay finished, and the document's status. */}
        <output className="status" data-streaming={streaming} data-status={t.status}>
          {streaming ? "streaming" : t.status}
        </output>
      </div>
      <Typstream ref={t.ref} source={source} isStreaming={streaming} target={target} animated caret />
    </main>
  );
}
