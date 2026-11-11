// The font picker: the families the plugins bring (`fonts`: Typst's own, a catalogue plugin's
// short list), and a search over every family of a catalogue's index, which is fetched when the
// menu first opens. Names only: a family's files are the engine's to load, when a document names it.

import type { EditorFontsSpec, FontCatalogueFile, FontCatalogueIndex } from "@typstream/core";
import type { EditorView } from "@typstream/editor-core";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, type MenuEntry, MenuList, Popover, revealHighlighted, usePopup } from "./ui";

/** A catalogue's `maxBytes` when it sets none (the engine's default). */
const MAX_BYTES = 5_000_000;

const bytes = (files: readonly FontCatalogueFile[]): number => files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);

/**
 * What the engine downloads of a family (its `pickFiles`): all of a small one; else, for each
 * style, its variable font, or the files nearest to regular and bold.
 */
const download = (files: readonly FontCatalogueFile[]): number => {
  if (bytes(files) <= 1_000_000) return bytes(files);
  const picked = new Set<FontCatalogueFile>();
  for (const style of ["normal", "italic"]) {
    const styled = files.filter((f) => f.style === style);
    const variable = styled.find((f) => Array.isArray(f.weight));
    const near = (w: number) =>
      styled.reduce<FontCatalogueFile | undefined>(
        (best, f) => (!best || Math.abs((f.weight as number) - w) < Math.abs((best.weight as number) - w) ? f : best),
        undefined,
      );
    for (const f of variable ? [variable] : [near(400), near(700)]) if (f) picked.add(f);
  }
  return bytes([...picked]);
};

/** How many families a search shows: the best of some two thousand. */
const SHOWN = 40;

/** Indexes' family names by URL: fetched once a page, whatever number of editors and menus. */
const indexes = new Map<string, Promise<string[]>>();

/** The families of a catalogue's index the engine would load, by name. */
const familiesOf = (spec: EditorFontsSpec): Promise<string[]> => {
  const url = spec.index;
  if (!url) return Promise.resolve([]);
  let names = indexes.get(url);
  if (!names) {
    const max = spec.maxBytes ?? MAX_BYTES;
    names = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FontCatalogueIndex>) : Promise.reject(new Error(r.statusText))))
      .then((index) =>
        Object.values(index.families)
          .filter((f) => download(f.files) <= max)
          .map((f) => f.name),
      )
      .catch(() => {
        // Asked again the next time the menu opens; the short lists are there meanwhile.
        indexes.delete(url);
        return [];
      });
    indexes.set(url, names);
  }
  return names;
};

/** A family the picker can list. */
interface Family {
  name: string;
  /** Its plugin's heading. */
  group?: string;
  /** The name it stands in for (`Arial`, for Arimo). */
  alias?: string;
}

/**
 * How well a family matches what was typed, lower first, `null` for no match: its name's start,
 * a word's start, its name, then the name it stands in for ("arial" finds Arimo).
 */
export const rankFont = (family: { name: string; alias?: string }, query: string): number | null => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = family.name.toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (family.alias?.toLowerCase().includes(q)) return 3;
  return null;
};

/** The searchable list: the plugins' short lists, or what the search finds in all they have. */
const FontList = ({
  specs,
  value,
  options,
  onSelect,
  onClose,
}: {
  specs: EditorFontsSpec[];
  value: string | null;
  options: { value: string | null; label: string }[];
  onSelect: (family: string | null) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [indexed, setIndexed] = useState<string[][]>([]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    Promise.all(specs.map(familiesOf)).then((all) => {
      if (live) setIndexed(all);
    });
    return () => {
      live = false;
    };
  }, [specs]);
  const found = useMemo(() => {
    const q = query.trim();
    const seen = new Set<string>();
    const out: Family[] = [];
    const add = (name: string, group: string | undefined, alias?: string) => {
      const key = `${name.toLowerCase()}|${alias ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, group, alias });
    };
    for (const [i, spec] of specs.entries()) {
      for (const name of spec.families) add(name, spec.label);
      if (!q) continue;
      for (const name of indexed[i] ?? []) add(name, spec.label);
      for (const [alias, name] of Object.entries(spec.aliases ?? {})) add(name, spec.label, alias);
    }
    if (!q) return out;
    const byName = new Set<string>();
    return (
      out
        .map((family, i) => ({ family, i, r: rankFont(family, q) }))
        .filter((x): x is { family: Family; i: number; r: number } => x.r !== null)
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.family)
        // A family found by its name isn't listed again for the one it stands in for.
        .filter((f) => !byName.has(f.name) && byName.add(f.name))
        .slice(0, SHOWN)
    );
  }, [specs, indexed, query]);
  const entries: MenuEntry[] = [
    ...(query.trim()
      ? []
      : options.map((o) => ({
          key: `option:${o.label}`,
          label: o.label,
          active: o.value === value,
          onSelect: () => onSelect(o.value),
        }))),
    ...found.map((f) => ({
      key: `${f.group ?? ""}:${f.name}`,
      label: f.name,
      description: f.alias && rankFont({ name: f.name }, query) === null ? `Like ${f.alias}` : undefined,
      group: f.group,
      active: f.name.toLowerCase() === value?.toLowerCase(),
      onSelect: () => onSelect(f.name),
    })),
  ];
  const move = (to: number) => {
    setHighlighted(Math.max(0, Math.min(to, entries.length - 1)));
    revealHighlighted(list.current);
  };
  return (
    <>
      <input
        className="tse-search"
        placeholder="Search fonts…"
        aria-label="Search fonts"
        // biome-ignore lint/a11y/noAutofocus: the menu opened to type into it
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(highlighted + 1);
          else if (e.key === "ArrowUp") move(highlighted - 1);
          else if (e.key === "Enter") entries[highlighted]?.onSelect();
          else if (e.key === "Tab") onClose();
          else return;
          e.preventDefault();
        }}
      />
      <div ref={list} className="tse-scroll">
        <MenuList entries={entries} highlighted={highlighted} onHighlight={setHighlighted} />
      </div>
    </>
  );
};

/** The toolbar's font button: the family at the selection, and the list to pick another from. */
export const FontMenu = ({
  view,
  label,
  value,
  options,
  onSelect,
}: {
  view: EditorView;
  label: string;
  value: string | null;
  options: { value: string | null; label: string }[];
  onSelect: (family: string | null) => void;
}) => {
  const { open, button, close, toggle, anchor } = usePopup();
  const specs = useMemo(() => view.plugins.flatMap((p) => (p.fonts ? [p.fonts] : [])), [view]);
  return (
    <>
      <Button label={label} buttonRef={button} expanded={open} popup="dialog" onClick={toggle}>
        <span className="tse-font-name">{value ?? label}</span>
        <ChevronDown className="tse-chevron" aria-hidden="true" />
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label={label} className="tse-searchable tse-fonts">
          <FontList
            specs={specs}
            value={value}
            options={options}
            onSelect={(family) => {
              close();
              onSelect(family);
            }}
            onClose={close}
          />
        </Popover>
      )}
    </>
  );
};
