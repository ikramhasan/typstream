import { DEFAULT_LINT, type LintRuleId, type LintSeverity } from "@typstream/heal";
import { type ChangeEvent, useRef } from "react";
import { CORPUS } from "../corpus";
import type { PlaygroundState, Source } from "../hash";
import { type Loaded, sourceFromText } from "../source";
import { SPLITS, type Split } from "../stream";

const SETS = [...new Set(CORPUS.map((c) => c.set))];
const RULES = Object.keys(DEFAULT_LINT) as LintRuleId[];

interface Props {
  state: PlaygroundState;
  loaded: Loaded | null;
  onSource: (source: Source) => void;
  onChange: (patch: Partial<PlaygroundState>) => void;
  onPaste: () => void;
  onSave: () => void;
}

export const Toolbar = ({ state, loaded, onSource, onChange, onPaste, onSave }: Props) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const corpusId = state.source.kind === "corpus" ? state.source.id : "";

  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onSource(sourceFromText(await file.text(), file.name));
    e.target.value = "";
  };

  const setLint = (rule: LintRuleId, severity: LintSeverity) => {
    const lint = { ...state.heal.lint };
    if (severity === DEFAULT_LINT[rule]) delete lint[rule];
    else lint[rule] = severity;
    onChange({ heal: { ...state.heal, lint } });
  };
  const lintChanges = Object.keys(state.heal.lint).length;

  return (
    <header className="toolbar">
      <strong className="brand">
        typstream <small>playground</small>
      </strong>
      <label>
        Corpus
        <select value={corpusId} onChange={(e) => e.target.value && onSource({ kind: "corpus", id: e.target.value })}>
          {corpusId ? null : <option value="">{loaded?.label ?? "custom"}</option>}
          {SETS.map((set) => (
            <optgroup key={set} label={set}>
              {CORPUS.filter((c) => c.set === set).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.recorded ? " (stream)" : ""}
                  {c.meta?.expect && c.meta.expect !== "ok" ? ` [${c.meta.expect}]` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <button type="button" onClick={onPaste}>
        Paste…
      </button>
      <button type="button" onClick={() => fileInput.current?.click()}>
        Open…
      </button>
      <input ref={fileInput} type="file" accept=".typ,.jsonl,.txt" hidden onChange={openFile} />
      <span className="sep" />
      <label title="Seed for synthesized streams. Recorded streams ignore it.">
        Seed
        <input
          type="number"
          min={0}
          value={state.seed}
          disabled={loaded?.recorded ?? false}
          onChange={(e) => onChange({ seed: Math.max(0, Number.parseInt(e.target.value, 10) || 0), at: null })}
        />
      </label>
      <label title="Step through the stream by provider chunk, by token, or by character.">
        Step
        <select value={state.split} onChange={(e) => onChange({ split: e.target.value as Split, at: null })}>
          {SPLITS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span className="sep" />
      <label title="HealOptions.dropIncompleteRules: drop half-written #set/#show rules instead of applying them">
        <input
          type="checkbox"
          checked={state.heal.dropIncompleteRules}
          onChange={(e) => onChange({ heal: { ...state.heal, dropIncompleteRules: e.target.checked } })}
        />
        Drop rules
      </label>
      <label title="HealOptions.unwrapFences">
        Fences
        <select
          value={state.heal.unwrapFences}
          onChange={(e) => onChange({ heal: { ...state.heal, unwrapFences: e.target.value as "auto" | "never" } })}
        >
          <option value="auto">auto</option>
          <option value="never">never</option>
        </select>
      </label>
      <details className="lint-menu">
        <summary>Lint{lintChanges > 0 ? ` (${lintChanges} changed)` : ""}</summary>
        <div className="lint-rules">
          {RULES.map((rule) => (
            <label key={rule}>
              <span>{rule}</span>
              <select
                value={state.heal.lint[rule] ?? DEFAULT_LINT[rule]}
                onChange={(e) => setLint(rule, e.target.value as LintSeverity)}
              >
                <option value="fix">fix</option>
                <option value="warn">warn</option>
                <option value="off">off</option>
              </select>
            </label>
          ))}
        </div>
      </details>
      <span className="grow" />
      <button
        type="button"
        className="primary"
        onClick={onSave}
        disabled={!loaded}
        title="The URL always links to this exact state; this saves the stream as corpus files"
      >
        Save as corpus case
      </button>
    </header>
  );
};
