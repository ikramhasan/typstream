import { type MouseEvent, useLayoutEffect, useMemo, useRef } from "react";
import { type Mark, runs } from "../marks";

interface Props {
  /** Raw panes show what patches remove, healed panes what they insert. */
  side: "raw" | "healed";
  title: string;
  subtitle: string;
  text: string;
  marks: readonly Mark[];
  /** Offset of the settled boundary in this pane's text; the rest is the unsettled tail. */
  settled: number;
  hoverPatch: number | null;
  onHoverPatch: (patch: number | null) => void;
  /** Keep the end of the text (where the stream is) in view. */
  follow: boolean;
}

const classOf = (marks: readonly Mark[], hoverPatch: number | null): string =>
  [...new Set(marks.map((m) => m.kind))].join(" ") +
  (hoverPatch !== null && marks.some((m) => m.patch === hoverPatch) ? " focus" : "");

export const SourcePane = ({
  side,
  title,
  subtitle,
  text,
  marks,
  settled,
  hoverPatch,
  onHoverPatch,
  follow,
}: Props) => {
  const pre = useRef<HTMLPreElement>(null);
  const parts = useMemo(() => runs(text.length, marks, settled), [text.length, marks, settled]);

  // Only when the text changes, so hovering doesn't undo the reader's own scrolling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger, not an input.
  useLayoutEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [text, follow]);

  // One listener for every run: the hovered patch is on the run's data attribute.
  const onMove = (e: MouseEvent) => {
    const patch = (e.target as HTMLElement).closest<HTMLElement>("[data-patch]")?.dataset.patch;
    onHoverPatch(patch === undefined ? null : Number(patch));
  };

  return (
    <section className={`pane source-pane ${side}`}>
      <h2>
        {title} <small>{subtitle}</small>
      </h2>
      <pre ref={pre} onMouseMove={onMove} onMouseLeave={() => onHoverPatch(null)}>
        {parts.map((r) => {
          const patch = r.marks.find((m) => m.patch !== undefined)?.patch;
          const title = r.marks.map((m) => m.title).join("\n") || undefined;
          const unsettled = r.unsettled ? " unsettled" : "";
          if (r.caret) {
            return (
              <span
                key={`c${r.from}`}
                className={`caret ${classOf(r.marks, hoverPatch)}${unsettled}`}
                title={title}
                data-patch={patch}
              />
            );
          }
          if (r.marks.length === 0) {
            return r.unsettled ? (
              <span key={r.from} className="unsettled">
                {text.slice(r.from, r.to)}
              </span>
            ) : (
              text.slice(r.from, r.to)
            );
          }
          return (
            <span
              key={r.from}
              className={`${classOf(r.marks, hoverPatch)}${unsettled}`}
              title={title}
              data-patch={patch}
            >
              {text.slice(r.from, r.to)}
            </span>
          );
        })}
      </pre>
    </section>
  );
};
