import { useMemo, useState } from "react";
import { CORPUS } from "../corpus";
import type { PlaygroundState } from "../hash";
import { caseFiles, download, slug } from "../save";
import type { Loaded } from "../source";
import { Dialog } from "./Dialog";

interface Props {
  state: PlaygroundState;
  loaded: Loaded;
  at: number;
  steps: number;
  onClose: () => void;
}

const SETS = [...new Set(CORPUS.map((c) => c.set))];

export const SaveDialog = ({ state, loaded, at, steps, onClose }: Props) => {
  const corpusMeta = state.source.kind === "corpus" ? CORPUS.find((c) => c.id === loaded.label)?.meta : undefined;
  const [name, setName] = useState(() => slug(loaded.label.split("/").pop() ?? "case"));
  const [set, setSet] = useState(() => (state.source.kind === "corpus" ? loaded.label.split("/")[0] : "edu") ?? "edu");
  const [category, setCategory] = useState(corpusMeta?.category ?? "");
  const [notes, setNotes] = useState(`Recorded in the playground; look at step ${at} of ${steps} (${state.split}).`);

  const file = slug(name);
  const files = useMemo(
    () =>
      caseFiles({
        name: file,
        category,
        chunks: loaded.chunks,
        stream: loaded.recorded
          ? (corpusMeta?.stream ?? { source: "recorded" })
          : { source: "synthetic", options: { seed: state.seed } },
        notes,
      }),
    [file, category, loaded, corpusMeta, state.seed, notes],
  );

  return (
    <Dialog title="Save as corpus case" onClose={onClose}>
      <p className="hint">
        Downloads <code>{file}.typ</code> (the whole stream joined) and <code>{file}.stream.jsonl</code> (the stream as
        loaded, before any step splitting). Put both in <code>corpus/{set}/</code>, add the entry below to{" "}
        <code>corpus/{set}/meta.json</code>, then run <code>pnpm corpus:validate --write-pages</code> and{" "}
        <code>pnpm fix</code> (corpus/README.md).
      </p>
      <div className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Set
          <select value={set} onChange={(e) => setSet(e.target.value)}>
            {SETS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="worksheet, quiz, …" />
        </label>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <pre className="meta-snippet">{files.meta}</pre>
      <footer>
        <button type="button" onClick={() => navigator.clipboard.writeText(files.meta)}>
          Copy meta.json entry
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            download(`${file}.typ`, files.typ);
            download(`${file}.stream.jsonl`, files.jsonl);
          }}
        >
          Download .typ + .stream.jsonl
        </button>
      </footer>
    </Dialog>
  );
};
