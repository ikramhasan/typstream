import { ALL_SETS, loadCorpus } from "@typstream/corpus";
import { beforeAll, describe, expect, it } from "vitest";
import { hasErrors, isSyntaxLoaded, parse, SYNTAX_KINDS, type SyntaxNode, walk } from "../src/index";
import { kind_names } from "../wasm/syntax.js";
import { load } from "./support";

beforeAll(load);

/** The leaves' text in order, or null if a node isn't contiguous with its children. */
const leaves = (node: SyntaxNode, text: string): string | null => {
  if (node.children.length === 0) return text.slice(node.from, node.to);
  let at = node.from;
  let out = "";
  for (const child of node.children) {
    const inner = child.from === at ? leaves(child, text) : null;
    if (inner === null) return null;
    out += inner;
    at = child.to;
  }
  return at === node.to ? out : null;
};

const shape = (node: SyntaxNode, text: string): unknown =>
  node.children.length === 0
    ? `${node.kind} ${JSON.stringify(text.slice(node.from, node.to))}`
    : { [node.kind]: node.children.map((c) => shape(c, text)) };

describe("@typstream/syntax", () => {
  it("names kinds as the wasm does", () => {
    expect(isSyntaxLoaded()).toBe(true);
    expect([...SYNTAX_KINDS]).toEqual(kind_names());
  });

  it("parses markup into Typst's tree, with UTF-16 offsets", () => {
    const text = "= Hi\n*bold* 😀 _é_ #f(1)[x] $a^2$";
    const root = parse(text);
    expect(root).toMatchObject({ kind: "Markup", from: 0, to: text.length });
    expect(shape(root, text)).toEqual({
      Markup: [
        { Heading: ['HeadingMarker "="', 'Space " "', { Markup: ['Text "Hi"'] }] },
        'Space "\\n"',
        { Strong: ['Star "*"', { Markup: ['Text "bold"'] }, 'Star "*"'] },
        'Space " "',
        'Text "😀"',
        'Space " "',
        { Emph: ['Underscore "_"', { Markup: ['Text "é"'] }, 'Underscore "_"'] },
        'Space " "',
        'Hash "#"',
        {
          FuncCall: [
            'Ident "f"',
            {
              Args: [
                'LeftParen "("',
                'Int "1"',
                'RightParen ")"',
                { ContentBlock: ['LeftBracket "["', { Markup: ['Text "x"'] }, 'RightBracket "]"'] },
              ],
            },
          ],
        },
        'Space " "',
        {
          Equation: [
            'Dollar "$"',
            { Math: [{ MathAttach: ['MathText "a"', 'Hat "^"', 'MathText "2"'] }] },
            'Dollar "$"',
          ],
        },
      ],
    });
    expect(hasErrors(root)).toBe(false);
  });

  it("keeps errors as nodes", () => {
    const root = parse("#f(");
    expect(hasErrors(root)).toBe(true);
    expect(root.to).toBe(3);
  });

  it("covers every corpus document losslessly", () => {
    for (const entry of loadCorpus({ sets: ALL_SETS })) {
      const root = parse(entry.source);
      if (leaves(root, entry.source) !== entry.source) expect.fail(`${entry.id}: the tree doesn't cover the text`);
      let count = 0;
      walk(root, () => {
        count++;
      });
      expect(count, entry.id).toBeGreaterThan(1);
    }
  });

  it("builds deep trees without recursion", () => {
    const text = `${"#[".repeat(2000)}x${"]".repeat(2000)}`;
    expect(parse(text).to).toBe(text.length);
  });
});
