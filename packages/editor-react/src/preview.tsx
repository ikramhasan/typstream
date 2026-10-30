// Compiled previews of what the editor shows as code (PLAN §10.3, #36): a `#question[…]`, a
// table or a CeTZ drawing must look as it compiles, and that depends on the whole document
// (question numbers, `#let` helpers, templates). So the whole source compiles in a hidden
// `<Typstream>` (HTML target, with the engine's source anchors, PLAN §10.2), and each block shows
// copies of the compiled blocks whose anchors fall in its source range. The copies come from the
// renderer's sanitized DOM, so nothing new reaches the page.
//
// While the teacher types, the compiled document lags behind the source. Previews are taken only
// when the compiled source is the editor's source, and in between each block keeps its last one.

import type { TypstDocument, TypstValue } from "@typstream/editor-core";
import { Typstream, type TypstreamHandle, type TypstreamProps } from "@typstream/react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/** What a block of the editor shows from the compiled document. */
export interface BlockPreview {
  /** Copies of the compiled top-level blocks in the block's source range. */
  nodes: Node[];
  /** Copies of the inline equations (MathML) in those blocks, in order. */
  inlineMath: Element[];
  /** Copies of the display equations in those blocks, in order. */
  displayMath: Element[];
}

export class PreviewStore {
  private previews = new Map<string, BlockPreview>();
  private listeners = new Set<() => void>();
  private version = 0;

  get(id: string | undefined): BlockPreview | undefined {
    return id === undefined ? undefined : this.previews.get(id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /**
   * Reads the compiled blocks out of `root` for the value's blocks (ranges from `doc`). The engine
   * anchors only block starts (PLAN §10.2): a block right after a heading, or consecutive list items,
   * share the anchor before them, and every compiled block after it carries its offset. So the
   * compiled blocks of an anchor go to the editor's blocks from it on, one each in order, except that
   * consecutive list items share their list and rules and comments, which show nothing, take none; the
   * last block of an anchor takes what is left. Equations are counted within each compiled block.
   */
  update(root: Element, doc: TypstDocument, value: TypstValue): void {
    const byOffset = new Map<number, Element[]>();
    for (const element of root.querySelectorAll<HTMLElement>("[data-typstream-src]")) {
      const offset = Number(element.dataset.typstreamSrc);
      if (Number.isFinite(offset)) byOffset.set(offset, [...(byOffset.get(offset) ?? []), element]);
    }
    const offsets = [...byOffset.keys()].sort((a, b) => a - b);
    const blocks = value.flatMap((block) => {
      const range = block.id ? doc.rangeOf(block.id) : undefined;
      if (!block.id || !range) return [];
      const own = offsets.filter((o) => o >= range.from && o < Math.max(range.to, range.from + 1));
      return [{ block, id: block.id, range, own }];
    });
    const next = new Map<string, BlockPreview>();
    let group: { elements: Element[]; next: number } | null = null;
    let current: { element: Element; inline: Element[]; display: Element[]; used: number; usedDisplay: number } | null =
      null;
    let previousList = false;
    blocks.forEach(({ block, id, range, own }, i) => {
      if (own.length > 0) {
        group = { elements: own.flatMap((o) => byOffset.get(o) ?? []), next: 0 };
        current = null;
        previousList = false;
      } else if (!group) {
        const before = offsets.filter((o) => o <= range.from).at(-1);
        if (before === undefined) return;
        group = { elements: byOffset.get(before) ?? [], next: 0 };
      }
      const g = group as { elements: Element[]; next: number };
      const list = block.type === "p" && (block.listStyleType !== undefined || (block.indent ?? 0) >= 1);
      const silent = block.type === "typst_code" && block.role !== "content";
      const last = (blocks[i + 1]?.own.length ?? 1) > 0;
      let nodes: Element[] = [];
      if (!silent && !(list && previousList && current)) {
        const taken = last && !list ? g.elements.slice(g.next) : g.elements.slice(g.next, g.next + 1);
        g.next += taken.length;
        nodes = taken;
        const math = taken.flatMap((e) => (e.localName === "math" ? [e] : [...e.querySelectorAll("math")]));
        current = taken[0]
          ? {
              element: taken[0],
              inline: math.filter((m) => m.getAttribute("display") !== "block"),
              display: math.filter((m) => m.getAttribute("display") === "block"),
              used: 0,
              usedDisplay: 0,
            }
          : null;
      }
      if (!silent) previousList = list;
      const c = current as typeof current;
      const inlines = countNodes(block, "typst_inline_equation");
      const displays = block.type === "typst_equation" ? 1 : 0;
      next.set(id, {
        nodes: nodes.map((e) => e.cloneNode(true)),
        inlineMath: (c?.inline.slice(c.used, c.used + inlines) ?? []).map((m) => m.cloneNode(true) as Element),
        displayMath: (c?.display.slice(c.usedDisplay, c.usedDisplay + displays) ?? []).map(
          (m) => m.cloneNode(true) as Element,
        ),
      });
      if (c) {
        c.used += inlines;
        c.usedDisplay += displays;
      }
    });
    // Blocks the compile didn't show (yet) keep what they had.
    for (const [id, preview] of this.previews) if (!next.has(id) && doc.rangeOf(id)) next.set(id, preview);
    this.previews = next;
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/** How many nodes of a type a node has inside it. */
const countNodes = (node: unknown, type: string): number => {
  const n = node as { type?: string; children?: unknown[] };
  return (
    (n.type === type ? 1 : 0) + (n.children ?? []).reduce<number>((sum, child) => sum + countNodes(child, type), 0)
  );
};

const Context = createContext<PreviewStore | null>(null);

/** The compiled preview of a block, by its id; re-renders when previews change. */
export const useBlockPreview = (id: string | undefined): BlockPreview | undefined => {
  const store = useContext(Context);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getVersion ?? zero, store?.getVersion ?? zero);
  return store?.get(id);
};

const noSubscribe = () => () => {};
const zero = () => 0;

export interface PreviewProviderProps {
  store: PreviewStore;
  doc: TypstDocument | null;
  source: string;
  value: () => TypstValue;
  /** Settings for the hidden compile: plugins, engine, … (as `<Typstream>`'s). */
  typstream: Omit<TypstreamProps, "source" | "ref">;
  enabled: boolean;
  /** Receives the hidden `<Typstream>`'s handle (for exports). */
  onHandle?: (handle: TypstreamHandle | null) => void;
  children: ReactNode;
}

export const PreviewProvider = ({
  store,
  doc,
  source,
  value,
  typstream,
  enabled,
  onHandle,
  children,
}: PreviewProviderProps) => {
  const latest = useRef({ doc, source, value, onHandle });
  latest.current = { doc, source, value, onHandle };
  const [subscribe, setSubscribed] = useMemo(() => {
    let unsubscribe = () => {};
    return [
      (h: TypstreamHandle | null) => {
        unsubscribe();
        latest.current.onHandle?.(h);
        if (!h) return;
        let frame = 0;
        unsubscribe = h.subscribe(() => {
          cancelAnimationFrame(frame);
          // The renderer updates its DOM after the state changes.
          frame = requestAnimationFrame(() => {
            const { doc: d, source: s, value: v } = latest.current;
            const root = h.element;
            if (!d || !root || h.getState()?.status === "compiling") return;
            let compiled: string;
            try {
              compiled = h.exportSource();
            } catch {
              return;
            }
            if (compiled === s) store.update(root, d, v());
          });
        });
      },
      () => unsubscribe(),
    ] as const;
  }, [store]);
  useEffect(() => setSubscribed, [setSubscribed]);
  return (
    <Context.Provider value={store}>
      {children}
      {enabled ? (
        <div className="ts-preview-host" aria-hidden="true" inert>
          <Typstream
            {...typstream}
            ref={subscribe}
            source={source}
            target="html"
            lazy={false}
            animated={false}
            caret={false}
          />
        </div>
      ) : null}
    </Context.Provider>
  );
};

/** Shows copies of compiled nodes (from {@link BlockPreview}) in a container React doesn't manage. */
export const PreviewNodes = ({ nodes, className }: { nodes: readonly Node[]; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
  }, [nodes]);
  return <div ref={ref} className={`typstream${className ? ` ${className}` : ""}`} />;
};
