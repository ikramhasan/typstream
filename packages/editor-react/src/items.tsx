// The menus' items, shared by the fixed toolbar's insert and "turn into" menus and the slash menu:
// Plate's basic blocks, what Typst adds (equations, code, page breaks, tables), and what plugins
// add through their `editor` facet (edu's questions and callouts).

import type { EditorInsertItem, TypstreamPlugin } from "@typstream/core";
import {
  Braces,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Puzzle,
  Quote,
  Radical,
  Sigma,
  Table,
} from "lucide-react";
import type { PlateEditor } from "platejs/react";
import type { ReactNode } from "react";
import { type BlockKind, insertBlocks, insertInlineEquation, insertSource, turnInto, voidNode } from "./commands";
import type { MenuGroup, MenuItem } from "./ui";

export interface KindOption {
  kind: BlockKind;
  label: string;
  icon: ReactNode;
  keywords: string[];
}

export const KINDS: KindOption[] = [
  { kind: "p", label: "Text", icon: <Pilcrow />, keywords: ["paragraph", "plain"] },
  { kind: "h1", label: "Heading 1", icon: <Heading1 />, keywords: ["title", "h1", "="] },
  { kind: "h2", label: "Heading 2", icon: <Heading2 />, keywords: ["subtitle", "h2", "=="] },
  { kind: "h3", label: "Heading 3", icon: <Heading3 />, keywords: ["h3", "==="] },
  { kind: "h4", label: "Heading 4", icon: <Heading4 />, keywords: ["h4"] },
  { kind: "h5", label: "Heading 5", icon: <Heading5 />, keywords: ["h5"] },
  { kind: "h6", label: "Heading 6", icon: <Heading6 />, keywords: ["h6"] },
  { kind: "ul", label: "Bulleted list", icon: <List />, keywords: ["unordered", "bullet", "-"] },
  { kind: "ol", label: "Numbered list", icon: <ListOrdered />, keywords: ["ordered", "enum", "+"] },
  { kind: "blockquote", label: "Quote", icon: <Quote />, keywords: ["citation", "blockquote"] },
  { kind: "code_block", label: "Code block", icon: <Code2 />, keywords: ["raw", "```"] },
];

export const kindOption = (kind: BlockKind | undefined): KindOption =>
  KINDS.find((k) => k.kind === kind) ?? (KINDS[0] as KindOption);

const TABLE = "#table(\n  columns: 3,\n  [*Header*], [*Header*], [*Header*],\n  [], [], [],\n  [], [], [],\n)";

/** What can be inserted, grouped as Plate's insert menu groups them. */
export const insertGroups = (editor: PlateEditor, plugins: readonly TypstreamPlugin[], slash: boolean): MenuGroup[] => {
  const kinds = (slash ? KINDS : KINDS.filter((k) => k.kind !== "p")).map(
    (k): MenuItem => ({
      key: k.kind,
      label: k.label,
      icon: k.icon,
      keywords: k.keywords,
      onSelect: () => (slash ? turnInto(editor, k.kind) : insertKind(editor, k.kind)),
    }),
  );
  const typst: MenuItem[] = [
    {
      key: "equation",
      label: "Equation",
      icon: <Sigma />,
      hint: "A display equation in Typst math",
      keywords: ["math", "formula", "$"],
      onSelect: () => insertBlocks(editor, [voidNode({ type: "typst_equation", math: "" })]),
    },
    {
      key: "inline-equation",
      label: "Inline equation",
      icon: <Radical />,
      hint: "Math inside the text",
      keywords: ["math", "formula", "$"],
      onSelect: () => insertInlineEquation(editor, ""),
    },
    {
      key: "table",
      label: "Table",
      icon: <Table />,
      keywords: ["grid", "columns"],
      onSelect: () => insertSource(editor, TABLE),
    },
    {
      key: "divider",
      label: "Divider",
      icon: <Minus />,
      keywords: ["rule", "line", "hr", "---"],
      onSelect: () => insertBlocks(editor, [voidNode({ type: "hr" })]),
    },
    {
      key: "pagebreak",
      label: "Page break",
      icon: <FileText />,
      keywords: ["page", "break", "new page"],
      onSelect: () => insertBlocks(editor, [voidNode({ type: "typst_pagebreak" })]),
    },
    {
      key: "code",
      label: "Typst code",
      icon: <Braces />,
      hint: "Any Typst, shown compiled",
      keywords: ["typst", "code", "#", "function"],
      onSelect: () => insertBlocks(editor, [voidNode({ type: "typst_code", source: "#[]", role: "content" })]),
    },
  ];
  const groups: MenuGroup[] = [
    { label: "Basic blocks", items: kinds },
    { label: "Typst", items: typst },
  ];
  const byGroup = new Map<string, MenuItem[]>();
  for (const plugin of plugins) {
    const items = [...(plugin.editor?.slashItems ?? []), ...(plugin.editor?.toolbar ?? [])] as EditorInsertItem[];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const group = item.group ?? plugin.key;
      const list = byGroup.get(group) ?? [];
      list.push({
        key: `${plugin.key}/${item.key}`,
        label: item.label,
        icon: <Puzzle />,
        ...(item.description ? { hint: item.description } : {}),
        keywords: item.keywords ?? [],
        onSelect: () => insertSource(editor, item.insert),
      });
      byGroup.set(group, list);
    }
  }
  for (const [label, items] of byGroup) groups.push({ label, items });
  return groups;
};

/** Inserts an empty block of a kind after the selection's block (the insert menu). */
const insertKind = (editor: PlateEditor, kind: BlockKind): void => {
  insertBlocks(editor, [{ type: "p", children: [{ text: "" }] }]);
  turnInto(editor, kind);
};

/** Items whose label or keywords match the slash menu's query. */
export const filterGroups = (groups: MenuGroup[], query: string): MenuGroup[] => {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.label.toLowerCase().includes(q) || item.keywords?.some((k) => k.toLowerCase().includes(q)),
    ),
  }));
};
