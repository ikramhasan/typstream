// Render islands in React (PLAN §8.4, #28). @typstream/dom finds the markers
// and mounts islands through framework-free renderers; here each renderer only
// records the host and props it was given, and <Typstream> renders the
// island's component into the host through a portal. So islands are part of
// the app's tree: its context, StrictMode and Suspense reach them. dom keeps
// one host per island across updates, so a portal never changes container and
// a streaming island only gets new props.

import type { IslandProps } from "@typstream/core";
import type { IslandRenderers } from "@typstream/dom";
import { Component, type ComponentType, type ReactNode, Suspense } from "react";
import { createPortal } from "react-dom";

/**
 * A React component for an island: it renders into an element positioned
 * over the marker's fallback, which stays visible under it until it paints its
 * own background (while its code loads, say). @beta
 */
// biome-ignore lint/suspicious/noExplicitAny: each component narrows its own data.
export type IslandComponent<Data = any> = ComponentType<IslandProps<Data>>;

/** Island components by name, as plugins name them in their `islands` facet. @beta */
export type IslandComponents = Readonly<Record<string, IslandComponent>>;

interface Entry {
  id: number;
  host: HTMLElement;
  props: IslandProps;
}

/** The islands one <Typstream> has mounted, as a store React renders portals from. @internal */
export const createIslandStore = () => {
  let entries: readonly Entry[] = [];
  let ids = 0;
  const listeners = new Set<() => void>();
  const set = (next: readonly Entry[]) => {
    entries = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => entries,
    /** dom renderers for `names` that record their islands here. */
    renderers(names: readonly string[]): IslandRenderers {
      const render: IslandRenderers[string] = (host, props) => {
        const id = ids++;
        set([...entries, { id, host, props }]);
        return {
          update: (next) => set(entries.map((e) => (e.id === id ? { ...e, props: next } : e))),
          destroy: () => set(entries.filter((e) => e.id !== id)),
        };
      };
      return Object.fromEntries(names.map((name) => [name, render]));
    },
  };
};

/** A failing island leaves its fallback, and the rest of the document, as they are. */
class IslandBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    globalThis.reportError?.(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The portals of a <Typstream>'s islands. @internal */
export const islandPortals = (entries: readonly Entry[], components: IslandComponents | undefined): ReactNode[] =>
  entries.map(({ id, host, props }) => {
    const Island = components && Object.hasOwn(components, props.name) ? components[props.name] : undefined;
    if (!Island) return null;
    return createPortal(
      <IslandBoundary>
        <Suspense fallback={null}>
          <Island {...props} />
        </Suspense>
      </IslandBoundary>,
      host,
      String(id),
    );
  });
