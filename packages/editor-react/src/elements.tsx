// How each node of the editor's value looks (Plate's element and leaf components). Rich text is
// plain HTML styled like Plate UI's editor; what Typst computes (code, equations) shows the
// compiled output (preview.tsx) and is edited as source in a popover.

import { isOrderedList } from "@platejs/list";
import type {
  TypstCode,
  TypstCodeBlock,
  TypstEquation,
  TypstInlineCode,
  TypstInlineEquation,
  TypstLink,
} from "@typstream/editor-core";
import { Braces, Settings2 } from "lucide-react";
import type { TElement } from "platejs";
import {
  PlateElement,
  type PlateElementProps,
  PlateLeaf,
  type PlateLeafProps,
  type RenderNodeWrapper,
  useEditorRef,
  useReadOnly,
  useSelected,
} from "platejs/react";
import { type ReactNode, useRef, useState } from "react";
import { replaceWithSource } from "./commands";
import { PreviewNodes, useBlockPreview } from "./preview";
import { AnchoredPopover, SourceForm } from "./ui";

// A div, as Plate UI's: a list item's `<ul>` renders inside the paragraph's element.
export const ParagraphElement = (props: PlateElementProps) => <PlateElement {...props} as="div" className="ts-p" />;

export const headingElement = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const Heading = (props: PlateElementProps) => <PlateElement {...props} as={`h${level}`} />;
  Heading.displayName = `H${level}Element`;
  return Heading;
};

export const BlockquoteElement = (props: PlateElementProps) => <PlateElement {...props} as="blockquote" />;

export const LinkElement = (props: PlateElementProps<TypstLink & TElement>) => (
  <PlateElement
    {...props}
    as="a"
    attributes={{
      ...props.attributes,
      href: props.element.url,
      title: props.element.url,
      rel: "noreferrer",
      target: "_blank",
    }}
  />
);

export const CodeBlockElement = (props: PlateElementProps<TypstCodeBlock & TElement>) => (
  <PlateElement {...props} className="ts-code-block">
    {props.element.lang ? (
      <span className="ts-code-block-lang" contentEditable={false}>
        {props.element.lang}
      </span>
    ) : null}
    <code>{props.children}</code>
  </PlateElement>
);

export const CodeLineElement = (props: PlateElementProps) => <PlateElement {...props} as="div" />;

export const leaf = (as: keyof HTMLElementTagNameMap, className?: string) => {
  const Leaf = (props: PlateLeafProps) => <PlateLeaf {...props} as={as} className={className} />;
  Leaf.displayName = `${as}Leaf`;
  return Leaf;
};

export const CodeLeaf = leaf("code", "ts-inline-code");

/** Plate's indent lists: a block with a `listStyleType` renders inside a one-item `<ul>`/`<ol>`. */
export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return;
  return (inner) => {
    const element = inner.element as TElement & { listStyleType?: string; listStart?: number };
    const List = isOrderedList(element) ? "ol" : "ul";
    return (
      <List style={{ listStyleType: element.listStyleType, margin: 0, padding: 0 }} start={element.listStart}>
        <li>{inner.children}</li>
      </List>
    );
  };
};

// --- void nodes ---------------------------------------------------------------------------------

/** A void block: content the caret can't enter, selected as a whole, edited in a popover. */
const VoidBlock = ({
  props,
  className,
  children,
  popover,
}: {
  props: PlateElementProps;
  className?: string;
  children: (open: () => void) => ReactNode;
  popover?: (close: () => void, anchor: React.RefObject<HTMLDivElement | null>) => ReactNode;
}) => {
  const selected = useSelected();
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const open = () => {
    if (!readOnly && popover) setEditing(true);
  };
  return (
    <PlateElement
      {...props}
      className="ts-void"
      attributes={{ ...props.attributes, "data-selected": selected } as never}
    >
      <div ref={anchor} contentEditable={false} className={className}>
        {children(open)}
      </div>
      {editing && popover ? popover(() => setEditing(false), anchor) : null}
      {props.children}
    </PlateElement>
  );
};

export const HrElement = (props: PlateElementProps) => (
  <VoidBlock props={props} className="ts-hr">
    {() => <hr />}
  </VoidBlock>
);

export const PageBreakElement = (props: PlateElementProps) => (
  <VoidBlock props={props} className="ts-pagebreak">
    {() => "Page break"}
  </VoidBlock>
);

/** Typst code on its own lines: compiled, or a chip for rules; its source in a popover. */
export const TypstCodeElement = (props: PlateElementProps<TypstCode & TElement>) => {
  const editor = useEditorRef();
  const { element } = props;
  const preview = useBlockPreview(element.id as string | undefined);
  const label =
    element.role === "rule"
      ? "Typst rule"
      : element.role === "comment"
        ? "Comment"
        : element.call
          ? `#${element.call}`
          : "Typst";
  return (
    <VoidBlock
      props={props}
      className={element.role === "content" ? "ts-typst-block" : undefined}
      popover={(close, anchor) => (
        <AnchoredPopover anchor={anchor} label={`Edit ${label}`} onClose={close}>
          <SourceForm
            label="Typst"
            multiline
            initial={element.source}
            onCancel={close}
            onApply={(source) => {
              close();
              replaceWithSource(editor, element, source);
            }}
          />
        </AnchoredPopover>
      )}
    >
      {(open) =>
        element.role === "content" ? (
          // A click anywhere opens the source; the tag is the same as a button, for the keyboard.
          // biome-ignore lint/a11y/noStaticElementInteractions: the tag button below is the accessible way in
          // biome-ignore lint/a11y/useKeyWithClickEvents: the tag button below is the accessible way in
          <div onClick={open} title="Edit Typst">
            {preview && preview.nodes.length > 0 ? (
              <PreviewNodes nodes={preview.nodes} />
            ) : (
              <pre className="ts-typst-source">{element.source}</pre>
            )}
            <button type="button" className="ts-typst-block-tag" aria-label={`Edit ${label}`} onClick={open}>
              {label}
            </button>
          </div>
        ) : (
          <button type="button" className="ts-rule" onClick={open} title={element.source}>
            {element.role === "rule" ? <Settings2 /> : <Braces />}
            {firstLine(element.source)}
          </button>
        )
      }
    </VoidBlock>
  );
};

const firstLine = (source: string): string => {
  const line = source.split("\n")[0] ?? "";
  return line.length > 80 || source.includes("\n") ? `${line.slice(0, 80)}…` : line;
};

/** A display equation: the compiled MathML, its math in a popover. */
export const EquationElement = (props: PlateElementProps<TypstEquation & TElement>) => {
  const editor = useEditorRef();
  const { element } = props;
  const preview = useBlockPreview(element.id as string | undefined);
  const math = preview?.displayMath[0];
  return (
    <VoidBlock
      props={props}
      className="ts-equation"
      popover={(close, anchor) => (
        <AnchoredPopover anchor={anchor} label="Edit equation" onClose={close} placement="bottom">
          <SourceForm
            label="Equation (Typst math)"
            multiline
            initial={element.math}
            placeholder="x = (-b plus.minus sqrt(b^2 - 4a c)) / (2a)"
            onCancel={close}
            onApply={(value) => {
              close();
              editor.tf.setNodes({ math: value.trim() } as never, { at: editor.api.findPath(element) });
            }}
          />
        </AnchoredPopover>
      )}
    >
      {(open) => (
        <button
          type="button"
          className="ts-equation-button"
          onClick={open}
          title="Edit equation"
          aria-label="Edit equation"
        >
          {math ? (
            <PreviewNodes nodes={[math]} />
          ) : (
            <span className="ts-math-source">{element.math || "Empty equation"}</span>
          )}
        </button>
      )}
    </VoidBlock>
  );
};

/** An inline void with a popover: an equation or a chip of code. */
const InlineVoid = ({
  props,
  className,
  title,
  content,
  form,
}: {
  props: PlateElementProps;
  className: string;
  title: string;
  content: ReactNode;
  form: (close: () => void) => ReactNode;
}) => {
  const selected = useSelected();
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <PlateElement {...props} as="span" attributes={{ ...props.attributes, "data-selected": selected } as never}>
      <span ref={anchor} contentEditable={false}>
        <button
          type="button"
          className={className}
          data-selected={selected}
          title={title}
          onClick={() => !readOnly && setEditing(true)}
        >
          {content}
        </button>
      </span>
      {editing ? (
        <AnchoredPopover anchor={anchor} label={title} onClose={() => setEditing(false)}>
          {form(() => setEditing(false))}
        </AnchoredPopover>
      ) : null}
      {props.children}
    </PlateElement>
  );
};

/** Which inline equation of its block an element is, to find its compiled MathML. */
const useInlineMathIndex = (element: TElement): { blockId?: string; index: number } => {
  const editor = useEditorRef();
  const path = editor.api.findPath(element);
  const block = path ? editor.api.node<TElement>(path.slice(0, 1)) : undefined;
  if (!block) return { index: -1 };
  let index = -1;
  let found = -1;
  const visit = (node: unknown) => {
    const n = node as TElement;
    if (n.type === "typst_inline_equation") {
      index++;
      if (n === element) found = index;
    }
    for (const child of (n.children ?? []) as unknown[]) visit(child);
  };
  visit(block[0]);
  return { blockId: block[0].id as string | undefined, index: found };
};

export const InlineEquationElement = (props: PlateElementProps<TypstInlineEquation & TElement>) => {
  const editor = useEditorRef();
  const { element } = props;
  const { blockId, index } = useInlineMathIndex(element);
  const preview = useBlockPreview(blockId);
  const math = index >= 0 ? preview?.inlineMath[index] : undefined;
  return (
    <InlineVoid
      props={props}
      className="ts-equation-inline"
      title="Edit equation"
      content={math ? <InlineNodes node={math} /> : <span className="ts-math-source">${element.math}$</span>}
      form={(close) => (
        <SourceForm
          label="Equation (Typst math)"
          initial={element.math}
          placeholder="a^2 + b^2 = c^2"
          onCancel={close}
          onApply={(value) => {
            close();
            editor.tf.setNodes({ math: value.trim() } as never, { at: editor.api.findPath(element) });
          }}
        />
      )}
    />
  );
};

const InlineNodes = ({ node }: { node: Node }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const set = (host: HTMLSpanElement | null) => {
    ref.current = host;
    host?.replaceChildren(node.cloneNode(true));
  };
  return <span ref={set} className="typstream" />;
};

export const InlineCodeElement = (props: PlateElementProps<TypstInlineCode & TElement>) => {
  const editor = useEditorRef();
  const { element } = props;
  return (
    <InlineVoid
      props={props}
      className="ts-chip"
      title="Edit Typst"
      content={element.source}
      form={(close) => (
        <SourceForm
          label="Typst"
          initial={element.source}
          onCancel={close}
          onApply={(value) => {
            close();
            editor.tf.setNodes({ source: value } as never, { at: editor.api.findPath(element) });
          }}
        />
      )}
    />
  );
};
