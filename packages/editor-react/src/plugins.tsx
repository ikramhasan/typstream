// The Plate plugins of the editor: Plate's own for what Plate has (marks, headings, quotes, rules,
// lists, links, code blocks, colours, sizes, alignment), with components from elements.tsx, and
// ours for what only Typst has (code shown compiled, equations in Typst math, page breaks).
// Typing shortcuts write Typst's syntax: `= ` makes a heading, `- ` and `+ ` lists, `*bold*`.

import { CodeRules } from "@platejs/basic-nodes";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HighlightPlugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import {
  FontBackgroundColorPlugin,
  FontColorPlugin,
  FontSizePlugin,
  TextAlignPlugin,
} from "@platejs/basic-styles/react";
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import { LinkPlugin } from "@platejs/link/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { createBlockStartInputRule, createMarkInputRule, KEYS } from "platejs";
import { type AnyPlatePlugin, createPlatePlugin, ParagraphPlugin } from "platejs/react";
import {
  BlockList,
  BlockquoteElement,
  CodeBlockElement,
  CodeLeaf,
  CodeLineElement,
  EquationElement,
  HrElement,
  headingElement,
  InlineCodeElement,
  InlineEquationElement,
  LinkElement,
  leaf,
  PageBreakElement,
  ParagraphElement,
  TypstCodeElement,
} from "./elements";

const HEADINGS = [KEYS.h1, KEYS.h2, KEYS.h3, KEYS.h4, KEYS.h5, KEYS.h6];

/** Typst's own shortcuts, and the Markdown ones teachers may type out of habit. */
const inputRules = [
  ...HEADINGS.flatMap((node, i) =>
    ["=", "#"].map((marker) =>
      createBlockStartInputRule({ trigger: " ", match: marker.repeat(i + 1), mode: "set", node }),
    ),
  ),
  ...["-", "*"].map((match) =>
    createBlockStartInputRule({
      trigger: " ",
      match,
      apply: ({ editor }) => {
        toggleList(editor, { listStyleType: "disc" });
        return true;
      },
    }),
  ),
  ...["+", "1."].map((match) =>
    createBlockStartInputRule({
      trigger: " ",
      match,
      apply: ({ editor }) => {
        toggleList(editor, { listStyleType: "decimal" });
        return true;
      },
    }),
  ),
  createBlockStartInputRule({ trigger: " ", match: ">", mode: "set", node: KEYS.blockquote }),
  createMarkInputRule({ mark: KEYS.bold, start: "*", trigger: "*" }),
  createMarkInputRule({ mark: KEYS.italic, start: "_", trigger: "_" }),
  CodeRules.markdown(),
];

const InputRulesPlugin = createPlatePlugin({ key: "typst_input_rules", inputRules });

export const TypstCodePlugin = createPlatePlugin({
  key: "typst_code",
  node: { isElement: true, isVoid: true, component: TypstCodeElement },
});

export const TypstInlineCodePlugin = createPlatePlugin({
  key: "typst_inline_code",
  node: { isElement: true, isInline: true, isVoid: true, component: InlineCodeElement },
});

export const EquationPlugin = createPlatePlugin({
  key: "typst_equation",
  node: { isElement: true, isVoid: true, component: EquationElement },
});

export const InlineEquationPlugin = createPlatePlugin({
  key: "typst_inline_equation",
  node: { isElement: true, isInline: true, isVoid: true, component: InlineEquationElement },
});

export const PageBreakPlugin = createPlatePlugin({
  key: "typst_pagebreak",
  node: { isElement: true, isVoid: true, component: PageBreakElement },
});

/** The editor's Plate plugins. */
export const editorPlugins = (): AnyPlatePlugin[] => [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.withComponent(headingElement(1)),
  H2Plugin.withComponent(headingElement(2)),
  H3Plugin.withComponent(headingElement(3)),
  H4Plugin.withComponent(headingElement(4)),
  H5Plugin.withComponent(headingElement(5)),
  H6Plugin.withComponent(headingElement(6)),
  BlockquotePlugin.withComponent(BlockquoteElement),
  HorizontalRulePlugin.withComponent(HrElement),
  CodeBlockPlugin.withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  LinkPlugin.withComponent(LinkElement),
  BoldPlugin.withComponent(leaf("strong")),
  ItalicPlugin.withComponent(leaf("em")),
  UnderlinePlugin.withComponent(leaf("u")),
  StrikethroughPlugin.withComponent(leaf("s")),
  CodePlugin.withComponent(CodeLeaf),
  SubscriptPlugin.withComponent(leaf("sub")),
  SuperscriptPlugin.withComponent(leaf("sup")),
  HighlightPlugin.withComponent(leaf("mark")),
  FontColorPlugin,
  FontBackgroundColorPlugin,
  FontSizePlugin,
  TextAlignPlugin.configure({
    inject: {
      nodeProps: {
        nodeKey: "align",
        styleKey: "textAlign",
        defaultNodeValue: "left",
        validNodeValues: ["left", "center", "right", "justify"],
      },
      targetPlugins: [KEYS.p, ...HEADINGS],
    },
  }),
  // Only paragraphs indent: Typst nests lists by indentation and has nothing else to indent.
  IndentPlugin.configure({ inject: { isBlock: true, targetPlugins: [KEYS.p] } }),
  ListPlugin.configure({ inject: { targetPlugins: [KEYS.p] }, render: { belowNodes: BlockList } }),
  TypstCodePlugin,
  TypstInlineCodePlugin,
  EquationPlugin,
  InlineEquationPlugin,
  PageBreakPlugin,
  InputRulesPlugin,
];
