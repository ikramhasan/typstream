// Turns a HealResult into highlighted runs for the raw and healed panes.
//
// Coordinates: heal's `patches` go from the *normalized* input to `source`, while
// errors, findings and open frames are in input offsets. The raw pane shows the
// input, so patch ranges are mapped back through the normalizer's own patches.
import { type Patch, SourceMap } from "@typstream/core";
import type { HealResult, Normalized } from "@typstream/heal";

export type MarkKind = "patch" | "normalize" | "open" | "error" | "finding";

export interface Mark {
  from: number;
  to: number;
  kind: MarkKind;
  title: string;
  /** Index into `result.patches`, for hover linking between panes and the patch list. */
  patch?: number;
}

/** A run of text with the marks covering it, or (`caret`) an empty mark at a position. */
export interface Run {
  from: number;
  to: number;
  marks: Mark[];
  caret: boolean;
  /** At or after the settled boundary. */
  unsettled: boolean;
}

const quote = (text: string): string => JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);

export const describePatch = (p: Patch, normalized: string, source: string): string => {
  const removed = normalized.slice(p.original.from, p.original.to);
  const inserted = source.slice(p.result.from, p.result.to);
  const parts = [p.reason];
  if (removed) parts.push(`removes ${quote(removed)}`);
  if (inserted) parts.push(`inserts ${quote(inserted)}`);
  return parts.join(" · ");
};

export const rawMarks = (result: HealResult, norm: Normalized): Mark[] => {
  const normMap = new SourceMap(norm.patches);
  const marks: Mark[] = norm.patches.map((p) => ({
    from: p.original.from,
    to: p.original.to,
    kind: "normalize",
    title: `normalize · ${p.reason}`,
  }));
  result.patches.forEach((p, i) => {
    marks.push({
      from: normMap.toOriginal(p.original.from),
      to: normMap.toOriginal(p.original.to),
      kind: "patch",
      title: describePatch(p, norm.text, result.source),
      patch: i,
    });
  });
  for (const f of result.openFrames)
    marks.push({ from: f.open, to: f.open + 1, kind: "open", title: `open ${f.frame}` });
  for (const e of result.errors) marks.push({ from: e.start, to: e.end, kind: "error", title: e.message });
  for (const f of result.findings) {
    marks.push({ from: f.start, to: f.end, kind: "finding", title: `${f.rule} (${f.severity}): ${f.message}` });
  }
  return marks;
};

export const healedMarks = (result: HealResult, norm: Normalized): Mark[] =>
  result.patches.map((p, i) => ({
    from: p.result.from,
    to: p.result.to,
    kind: "patch",
    title: describePatch(p, norm.text, result.source),
    patch: i,
  }));

/** Splits `[0, length)` at every mark boundary and at `settled`; empty marks become carets. */
export const runs = (length: number, marks: readonly Mark[], settled: number): Run[] => {
  const points = new Set([0, length, Math.min(Math.max(settled, 0), length)]);
  for (const m of marks) {
    points.add(Math.min(m.from, length));
    points.add(Math.min(m.to, length));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const carets = marks.filter((m) => m.from >= m.to);
  const spans = marks.filter((m) => m.from < m.to);
  const out: Run[] = [];
  const caretsAt = (pos: number) => {
    const here = carets.filter((m) => Math.min(m.from, length) === pos);
    if (here.length > 0) out.push({ from: pos, to: pos, marks: here, caret: true, unsettled: pos >= settled });
  };
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i] as number;
    const to = sorted[i + 1] as number;
    caretsAt(from);
    const covering = spans.filter((m) => m.from <= from && m.to >= to);
    out.push({ from, to, marks: covering, caret: false, unsettled: from >= settled });
  }
  caretsAt(length);
  return out;
};
