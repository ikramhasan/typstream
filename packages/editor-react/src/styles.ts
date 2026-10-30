// The editor's look, after Plate UI's (shadcn/ui): ghost icon buttons in a toolbar, popovers with
// a border and a shadow, the document set like Plate's editor. Plain CSS on shadcn's variables
// (`--background`, `--foreground`, `--muted`, `--accent`, `--border`, `--ring`, `--popover`,
// `--radius`), so it fits a shadcn app as it is and has defaults elsewhere; a published package
// can't rely on the app's Tailwind. Injected as a constructable stylesheet where supported, so no
// `style-src 'unsafe-inline'` is needed (as @typstream/dom's).

export const EDITOR_CSS = `
.ts-editor {
  --ts-bg: var(--background, #fff);
  --ts-fg: var(--foreground, #0a0a0a);
  --ts-muted: var(--muted, #f4f4f5);
  --ts-muted-fg: var(--muted-foreground, #71717a);
  --ts-accent: var(--accent, #f4f4f5);
  --ts-accent-fg: var(--accent-foreground, #18181b);
  --ts-border: var(--border, #e4e4e7);
  --ts-ring: var(--ring, #a1a1aa);
  --ts-popover: var(--popover, #fff);
  --ts-popover-fg: var(--popover-foreground, #0a0a0a);
  --ts-brand: var(--primary, #18181b);
  --ts-radius: var(--radius, 0.625rem);
  --ts-code: var(--ts-muted);
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ts-bg);
  color: var(--ts-fg);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .ts-editor:where(:not(.light *)) {
    --ts-bg: var(--background, #0a0a0a);
    --ts-fg: var(--foreground, #fafafa);
    --ts-muted: var(--muted, #27272a);
    --ts-muted-fg: var(--muted-foreground, #a1a1aa);
    --ts-accent: var(--accent, #27272a);
    --ts-accent-fg: var(--accent-foreground, #fafafa);
    --ts-border: var(--border, #27272a);
    --ts-ring: var(--ring, #71717a);
    --ts-popover: var(--popover, #18181b);
    --ts-popover-fg: var(--popover-foreground, #fafafa);
    --ts-brand: var(--primary, #fafafa);
  }
}
.ts-editor *, .ts-popover * { box-sizing: border-box; }

/* Toolbars */
.ts-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  user-select: none;
}
.ts-fixed-toolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  flex-wrap: wrap;
  padding: 4px 8px;
  border-bottom: 1px solid var(--ts-border);
  background: color-mix(in oklab, var(--ts-bg) 95%, transparent);
  backdrop-filter: blur(6px);
}
.ts-floating-toolbar {
  z-index: 50;
  padding: 4px;
  border: 1px solid var(--ts-border);
  border-radius: calc(var(--ts-radius) - 2px);
  background: var(--ts-popover);
  color: var(--ts-popover-fg);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
  white-space: nowrap;
}
.ts-toolbar-group { display: flex; align-items: center; gap: 2px; }
.ts-separator { width: 1px; height: 24px; margin: 0 4px; border: 0; background: var(--ts-border); flex: none; }
.ts-toolbar .ts-spacer { flex: 1; }
.ts-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  min-width: 32px;
  padding: 0 6px;
  border: 0;
  border-radius: calc(var(--ts-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms, color 120ms;
}
.ts-button:hover { background: var(--ts-muted); }
.ts-button[aria-pressed="true"], .ts-button[aria-expanded="true"] { background: var(--ts-accent); color: var(--ts-accent-fg); }
.ts-button:focus-visible { outline: 2px solid var(--ts-ring); outline-offset: 1px; }
.ts-button:disabled { opacity: 0.5; cursor: default; }
.ts-button svg { width: 16px; height: 16px; flex: none; }
.ts-button .ts-chevron { width: 12px; height: 12px; opacity: 0.6; }
.ts-button-label { font-size: 14px; }
.ts-button-ai { color: var(--ts-brand); font-weight: 500; }
.ts-font-size { display: inline-flex; align-items: center; }
.ts-font-size input {
  width: 40px;
  height: 28px;
  border: 1px solid var(--ts-border);
  border-radius: calc(var(--ts-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: center;
}

/* Popovers and menus */
.ts-popover {
  z-index: 60;
  min-width: 180px;
  max-height: min(420px, 70vh);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--ts-border);
  border-radius: calc(var(--ts-radius) - 2px);
  background: var(--ts-popover);
  color: var(--ts-popover-fg);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  animation: ts-pop-in 120ms ease-out;
}
@keyframes ts-pop-in { from { opacity: 0; transform: scale(0.97); } }
@media (prefers-reduced-motion: reduce) { .ts-popover { animation: none; } }
.ts-menu-label { padding: 6px 8px 4px; font-size: 12px; font-weight: 500; color: var(--ts-muted-fg); }
.ts-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: calc(var(--ts-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.ts-menu-item[data-active="true"], .ts-menu-item:hover { background: var(--ts-accent); color: var(--ts-accent-fg); }
.ts-menu-item svg { width: 16px; height: 16px; flex: none; opacity: 0.8; }
.ts-menu-item .ts-check { margin-inline-start: auto; }
.ts-menu-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ts-menu-item-hint { font-size: 12px; color: var(--ts-muted-fg); overflow: hidden; text-overflow: ellipsis; }
.ts-menu-empty { padding: 8px; color: var(--ts-muted-fg); font-size: 13px; }
.ts-menu-separator { height: 1px; margin: 4px -4px; background: var(--ts-border); }
.ts-swatches { display: grid; grid-template-columns: repeat(10, 22px); gap: 4px; padding: 4px; }
.ts-swatch {
  width: 22px;
  height: 22px;
  border: 1px solid var(--ts-border);
  border-radius: 999px;
  cursor: pointer;
  padding: 0;
}
.ts-swatch[aria-pressed="true"] { outline: 2px solid var(--ts-ring); outline-offset: 1px; }
.ts-field { display: flex; flex-direction: column; gap: 6px; padding: 4px; min-width: 300px; }
.ts-field label { font-size: 12px; font-weight: 500; color: var(--ts-muted-fg); }
.ts-input, .ts-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--ts-border);
  border-radius: calc(var(--ts-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.ts-textarea { min-height: 120px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5; }
.ts-input:focus, .ts-textarea:focus { outline: 2px solid var(--ts-ring); outline-offset: -1px; }
.ts-field-actions { display: flex; justify-content: flex-end; gap: 6px; }
.ts-field-actions .ts-button { border: 1px solid var(--ts-border); }
.ts-field-actions .ts-button-primary { background: var(--ts-brand); color: var(--ts-bg); border-color: transparent; }
.ts-field-actions .ts-button-primary:hover { opacity: 0.9; background: var(--ts-brand); }

/* The document */
.ts-scroll { flex: 1; min-height: 0; overflow: auto; }
.ts-content {
  position: relative;
  min-height: 100%;
  padding: 16px max(24px, calc((100% - 760px) / 2)) 96px;
  outline: none;
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: break-word;
  caret-color: var(--ts-fg);
}
.ts-content [data-slate-placeholder] { color: var(--ts-muted-fg); opacity: 1 !important; }
.ts-content .ts-p { margin: 0; padding: 2px 0; }
.ts-content h1, .ts-content h2, .ts-content h3, .ts-content h4, .ts-content h5, .ts-content h6 {
  margin: 0;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.ts-content h1 { font-size: 1.875em; padding: 0.6em 0 0.15em; font-weight: 700; }
.ts-content h2 { font-size: 1.5em; padding: 0.55em 0 0.1em; }
.ts-content h3 { font-size: 1.25em; padding: 0.45em 0 0.1em; }
.ts-content h4 { font-size: 1.1em; padding: 0.4em 0 0.1em; }
.ts-content h5, .ts-content h6 { font-size: 1em; padding: 0.35em 0 0.1em; }
.ts-content blockquote { margin: 8px 0; padding-inline-start: 24px; border-inline-start: 2px solid var(--ts-border); font-style: italic; }
.ts-content code.ts-inline-code {
  padding: 0.15em 0.3em;
  border-radius: 4px;
  background: var(--ts-code);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
  white-space: pre-wrap;
}
.ts-content mark { background: #fde68a; color: inherit; border-radius: 2px; }
.ts-content a { color: inherit; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: color-mix(in oklab, currentColor 45%, transparent); }
.ts-content ul, .ts-content ol { margin: 0; padding: 0; }
.ts-content li { margin-inline-start: 1.5em; padding-inline-start: 2px; }
.ts-content hr { margin: 0; height: 2px; border: 0; background: var(--ts-muted); }
.ts-void { margin: 4px 0; border-radius: calc(var(--ts-radius) - 4px); }
.ts-void[data-selected="true"] { box-shadow: 0 0 0 2px var(--ts-ring); }
.ts-hr { padding: 12px 0; cursor: pointer; }
.ts-pagebreak { display: flex; align-items: center; gap: 8px; padding: 8px 0; color: var(--ts-muted-fg); font-size: 12px; cursor: pointer; }
.ts-pagebreak::before, .ts-pagebreak::after { content: ""; flex: 1; border-top: 1px dashed var(--ts-border); }
.ts-code-block {
  margin: 8px 0;
  padding: 16px 20px;
  border-radius: calc(var(--ts-radius) - 4px);
  background: var(--ts-code);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
  tab-size: 2;
}
.ts-code-block-lang { float: right; font-size: 12px; color: var(--ts-muted-fg); user-select: none; }

/* Typst code shown compiled, and chips */
.ts-typst-block { position: relative; cursor: pointer; }
.ts-typst-block:hover { box-shadow: 0 0 0 1px var(--ts-border); }
.ts-typst-block .typstream { pointer-events: none; }
.ts-typst-block-tag {
  border: 0;
  cursor: pointer;
  position: absolute;
  inset-inline-end: 4px;
  top: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ts-muted);
  color: var(--ts-muted-fg);
  font-size: 11px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  opacity: 0;
  transition: opacity 120ms;
}
.ts-typst-block:hover .ts-typst-block-tag, .ts-void[data-selected="true"] .ts-typst-block-tag, .ts-typst-block-tag:focus-visible { opacity: 1; }
.ts-equation-button, .ts-chip, .ts-equation-inline { border: 0; background: none; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.ts-equation-button { display: block; width: 100%; padding: 4px 0; text-align: center; }
.ts-typst-source {
  margin: 0;
  padding: 8px 12px;
  border-radius: calc(var(--ts-radius) - 4px);
  background: var(--ts-code);
  color: var(--ts-muted-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  white-space: pre-wrap;
}
.ts-rule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 2px 0;
  padding: 2px 8px;
  border: 1px solid var(--ts-border);
  border-radius: 999px;
  color: var(--ts-muted-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ts-rule svg { width: 12px; height: 12px; flex: none; }
button.ts-chip {
  display: inline;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--ts-muted);
  color: var(--ts-muted-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  cursor: pointer;
}
.ts-chip[data-selected="true"], .ts-equation-inline[data-selected="true"] { box-shadow: 0 0 0 2px var(--ts-ring); }
.ts-equation { display: flex; justify-content: center; padding: 8px 0; cursor: pointer; }
.ts-equation-inline { padding: 0 1px; border-radius: 3px; cursor: pointer; }
.ts-equation-inline:hover, .ts-equation:hover { background: var(--ts-muted); }
.ts-math-source { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; color: var(--ts-muted-fg); }
.ts-preview-host {
  position: absolute;
  inset-inline-start: -100000px;
  top: 0;
  width: 760px;
  visibility: hidden;
  pointer-events: none;
}
.ts-loading { padding: 24px; color: var(--ts-muted-fg); font-size: 14px; }
`;

const injected = new WeakMap<Node, boolean>();

/** Adds the editor's stylesheet to the document or shadow root `node` is in, once. */
export const injectEditorCss = (node: Node): void => {
  const target = node.getRootNode() as Document | ShadowRoot;
  if (injected.get(target)) return;
  injected.set(target, true);
  const doc = node.ownerDocument ?? (node as Document);
  const Sheet = (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet;
  if (Sheet && "adoptedStyleSheets" in target && "replaceSync" in Sheet.prototype) {
    const sheet = new Sheet();
    sheet.replaceSync(EDITOR_CSS);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    return;
  }
  const style = doc.createElement("style");
  style.textContent = EDITOR_CSS;
  (target.nodeType === 11 ? target : doc.head).append(style);
};
