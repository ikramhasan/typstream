// Render islands (PLAN §8.4, #28): interactive components mounted over the
// markers Typst writes around their fallback drawing. The renderers find the
// markers (the HTML renderer in its DOM, the paged view in the artifact's
// `islands`) and give them to `createIslands`, which keeps one mounted island
// per marker identity (its name and its position among the islands of that
// name). A marker whose block is re-created while it streams gets the same
// host element moved into its new place, so a component isn't mounted again
// for every token, only updated.
//
// An island is an overlay over its own fallback: the host is positioned over
// the marker, which keeps the fallback's size, so nothing moves when it
// mounts. The fallback stays visible under it until the island paints its own
// background (its code may still be loading), and printing hides the host
// (the renderers' CSS). Assistive technology reads the island, not the
// fallback under it.

import type { CompileTarget, FileContent, IslandProps, IslandSpec, TypstreamPlugin } from "@typstream/core";

/** A mounted island, as its renderer returns it. @beta */
export interface IslandInstance {
  /** New props: the marker's data changed, it stopped being incomplete, or the document's files did. */
  update(props: IslandProps): void;
  /** The marker is gone, or the renderer is disposed: unmount. The host is removed after. */
  destroy(): void;
}

/**
 * Mounts an island into `host`, an empty element positioned over the
 * marker's fallback. Throwing, here or in `update`, keeps the fallback.
 * @beta
 */
export type IslandRenderer = (host: HTMLElement, props: IslandProps) => IslandInstance;

/** Island renderers by name: a marker is mounted only if a loaded plugin declares its name too. @beta */
export type IslandRenderers = Readonly<Record<string, IslandRenderer>>;

/** At most this many islands are mounted per document; later markers keep their fallback. */
export const MAX_ISLANDS = 50;
/** Longest data a marker may carry (its JSON, in the HTML target); a longer one keeps its fallback. */
export const MAX_ISLAND_DATA = 64 * 1024;

/** A marker a renderer found. */
export interface Marker {
  name: string;
  /** Its data, untrusted. */
  data: unknown;
  /** Its data as the renderer read it, to tell a change without comparing deeply. */
  raw: string;
  /** Where the host goes: the element it is positioned in. */
  place: HTMLElement;
  /** Offset of its source in the compiled text, if known. */
  from: number | null;
}

/** What the islands of one renderer need from it. */
export interface IslandsOptions {
  renderers: IslandRenderers;
  plugins?: readonly TypstreamPlugin[] | undefined;
  target: CompileTarget;
  /** `IslandProps.file`. Default: no files. */
  file?: ((path: string) => FileContent | null) | undefined;
}

/** When a marker is incomplete: the document streams and its source starts at or after `stable`. */
export interface IslandsState {
  /** The stable offset while streaming; `null` once the document is complete. */
  stable: number | null;
}

/** The islands of one renderer. */
export interface Islands {
  /** Mounts, moves, updates and unmounts islands to match `markers`, in document order. */
  sync(markers: readonly Marker[], state: IslandsState): void;
  destroy(): void;
}

/** On a marker element whose island is mounted over its fallback. */
export const MOUNTED = "data-typstream-island";

interface Mounted {
  host: HTMLElement;
  instance: IslandInstance | null;
  raw: string;
  incomplete: boolean;
  place: HTMLElement;
}

const noFile = (): null => null;

/** Keeps one island mounted per marker identity. */
export const createIslands = (options: IslandsOptions): Islands => {
  const specs = new Map<string, IslandSpec>();
  for (const plugin of options.plugins ?? []) {
    for (const [name, spec] of Object.entries(plugin.islands ?? {})) specs.set(name, spec);
  }
  const file = options.file ?? noFile;
  let mounted = new Map<string, Mounted>();

  /** Marks `place` as holding an island, its fallback hidden from assistive technology, or not. */
  const mark = (place: HTMLElement, host: HTMLElement | null): void => {
    for (const child of place.children) {
      if (child === host) continue;
      if (host) child.setAttribute("aria-hidden", "true");
      else child.removeAttribute("aria-hidden");
    }
    place.toggleAttribute(MOUNTED, host !== null);
  };

  const unmount = (m: Mounted): void => {
    try {
      m.instance?.destroy();
    } catch {
      // A broken island must not stop the document's updates.
    }
    m.host.remove();
    mark(m.place, null);
  };

  return {
    sync(markers, state) {
      const next = new Map<string, Mounted>();
      const counts = new Map<string, number>();
      for (const marker of markers) {
        if (next.size >= MAX_ISLANDS) break;
        const render = Object.hasOwn(options.renderers, marker.name) ? options.renderers[marker.name] : undefined;
        const spec = specs.get(marker.name);
        if (!render || !spec) continue;
        const index = counts.get(marker.name) ?? 0;
        counts.set(marker.name, index + 1);
        const key = `${marker.name}\u0000${index}`;
        const incomplete = state.stable !== null && marker.from !== null && marker.from >= state.stable;
        let m = mounted.get(key);
        mounted.delete(key);
        if (m && m.raw === marker.raw && m.incomplete === incomplete && m.instance) {
          // Unchanged; only its place may be new (its block was re-created).
          if (m.place !== marker.place) {
            m.place = marker.place;
            marker.place.append(m.host);
          }
          mark(marker.place, m.host);
          next.set(key, m);
          continue;
        }
        let data: unknown;
        try {
          data = spec.parse ? spec.parse(marker.data) : marker.data;
        } catch {
          data = undefined;
        }
        if (data === undefined) {
          if (m) unmount(m);
          continue;
        }
        const props: IslandProps = {
          name: marker.name,
          data,
          isIncomplete: incomplete,
          target: options.target,
          index,
          file,
        };
        if (!m) {
          const host = marker.place.ownerDocument.createElement("div");
          host.className = "typstream-island";
          m = { host, instance: null, raw: marker.raw, incomplete, place: marker.place };
        }
        m.raw = marker.raw;
        m.incomplete = incomplete;
        m.place = marker.place;
        if (m.host.parentNode !== marker.place) marker.place.append(m.host);
        try {
          if (m.instance) m.instance.update(props);
          else m.instance = render(m.host, props);
        } catch {
          unmount(m);
          continue;
        }
        mark(marker.place, m.host);
        next.set(key, m);
      }
      for (const m of mounted.values()) unmount(m);
      mounted = next;
    },
    destroy() {
      for (const m of mounted.values()) unmount(m);
      mounted = new Map();
    },
  };
};
