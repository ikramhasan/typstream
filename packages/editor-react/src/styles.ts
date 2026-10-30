// The editor's chrome, after Plate UI's (shadcn/ui): ghost icon buttons in a toolbar, menus and
// popovers with a border and a shadow. The document itself is the pages, as the page view draws
// them: nothing here styles it. Plain CSS on shadcn's variables (`--background`, `--foreground`,
// `--muted`, `--accent`, `--border`, `--ring`, `--popover`, `--primary`, `--radius`), so it fits a
// shadcn app as it is and has defaults elsewhere; a published package can't rely on the app's
// Tailwind. Injected as a constructable stylesheet, so strict CSPs need no `'unsafe-inline'`.

export const EDITOR_CSS = `
.tse-root {
  --tse-bg: var(--background, #fff);
  --tse-fg: var(--foreground, #0a0a0a);
  --tse-muted: var(--muted, #f4f4f5);
  --tse-muted-fg: var(--muted-foreground, #71717a);
  --tse-accent: var(--accent, #f4f4f5);
  --tse-accent-fg: var(--accent-foreground, #18181b);
  --tse-border: var(--border, #e4e4e7);
  --tse-ring: var(--ring, #a1a1aa);
  --tse-popover: var(--popover, #fff);
  --tse-popover-fg: var(--popover-foreground, #0a0a0a);
  --tse-primary: var(--primary, #18181b);
  --tse-primary-fg: var(--primary-foreground, #fafafa);
  --tse-destructive: var(--destructive, #dc2626);
  --tse-radius: var(--radius, 0.625rem);
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--tse-fg);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
}
.tse-root *, .tse-layer * { box-sizing: border-box; }
.tse-layer {
  --tse-bg: var(--background, #fff);
  --tse-fg: var(--foreground, #0a0a0a);
  --tse-muted: var(--muted, #f4f4f5);
  --tse-muted-fg: var(--muted-foreground, #71717a);
  --tse-accent: var(--accent, #f4f4f5);
  --tse-accent-fg: var(--accent-foreground, #18181b);
  --tse-border: var(--border, #e4e4e7);
  --tse-ring: var(--ring, #a1a1aa);
  --tse-popover: var(--popover, #fff);
  --tse-popover-fg: var(--popover-foreground, #0a0a0a);
  --tse-primary: var(--primary, #18181b);
  --tse-primary-fg: var(--primary-foreground, #fafafa);
  --tse-destructive: var(--destructive, #dc2626);
  --tse-radius: var(--radius, 0.625rem);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  color: var(--tse-popover-fg);
}

/* Toolbars */
.tse-toolbar { display: flex; align-items: center; gap: 2px; user-select: none; -webkit-user-select: none; }
.tse-fixed {
  position: sticky;
  top: 0;
  z-index: 30;
  flex-wrap: wrap;
  padding: 4px 6px;
  margin-bottom: 12px;
  border: 1px solid var(--tse-border);
  border-radius: var(--tse-radius);
  background: color-mix(in oklab, var(--tse-bg) 92%, transparent);
  backdrop-filter: blur(8px);
}
.tse-floating {
  position: fixed;
  z-index: 50;
  padding: 3px;
  border: 1px solid var(--tse-border);
  border-radius: calc(var(--tse-radius) - 2px);
  background: var(--tse-popover);
  box-shadow: 0 6px 24px -6px rgb(0 0 0 / 0.18), 0 2px 6px -2px rgb(0 0 0 / 0.08);
  animation: tse-in 120ms ease-out;
}
@keyframes tse-in { from { opacity: 0; transform: translateY(2px) scale(0.98); } }
.tse-separator { width: 1px; align-self: stretch; margin: 4px 3px; border: 0; background: var(--tse-border); }
.tse-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  min-width: 30px;
  padding: 0 7px;
  border: 0;
  border-radius: calc(var(--tse-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms, color 120ms;
}
.tse-button:hover:not(:disabled) { background: var(--tse-accent); color: var(--tse-accent-fg); }
.tse-button:focus-visible { outline: 2px solid var(--tse-ring); outline-offset: 1px; }
.tse-button[aria-pressed="true"], .tse-button[data-active] { background: var(--tse-accent); color: var(--tse-accent-fg); }
.tse-button:disabled { opacity: 0.4; cursor: default; }
.tse-button svg { width: 16px; height: 16px; flex: none; }
.tse-button .tse-chevron { width: 12px; height: 12px; opacity: 0.6; }
.tse-button[data-variant="primary"] { background: var(--tse-primary); color: var(--tse-primary-fg); }
.tse-button[data-variant="primary"]:hover { background: color-mix(in oklab, var(--tse-primary) 88%, transparent); color: var(--tse-primary-fg); }
.tse-button[data-variant="destructive"]:hover { background: color-mix(in oklab, var(--tse-destructive) 12%, transparent); color: var(--tse-destructive); }
.tse-swatch-dot { width: 14px; height: 4px; border-radius: 2px; margin-top: -2px; }
.tse-icon-stack { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; }

/* Menus and popovers */
.tse-popover {
  position: fixed;
  z-index: 60;
  min-width: 180px;
  max-height: min(420px, 70vh);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--tse-border);
  border-radius: calc(var(--tse-radius) - 2px);
  background: var(--tse-popover);
  color: var(--tse-popover-fg);
  box-shadow: 0 10px 38px -10px rgb(0 0 0 / 0.25), 0 10px 20px -15px rgb(0 0 0 / 0.15);
  animation: tse-in 120ms ease-out;
}
.tse-menu-label { padding: 6px 8px 4px; font-size: 12px; color: var(--tse-muted-fg); }
.tse-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: calc(var(--tse-radius) - 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.tse-menu-item:hover, .tse-menu-item[data-highlighted] { background: var(--tse-accent); color: var(--tse-accent-fg); }
.tse-menu-item svg { width: 16px; height: 16px; flex: none; opacity: 0.85; }
.tse-menu-item[data-active]::after { content: "✓"; margin-left: auto; font-size: 12px; }
.tse-menu-item small { display: block; color: var(--tse-muted-fg); font-size: 12px; }
.tse-menu-item .tse-item-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--tse-border); border-radius: 6px; background: var(--tse-bg); }
.tse-kbd { margin-left: auto; color: var(--tse-muted-fg); font-size: 11px; letter-spacing: 0.02em; }
.tse-search { width: 100%; height: 32px; margin-bottom: 4px; padding: 0 8px; border: 1px solid var(--tse-border); border-radius: calc(var(--tse-radius) - 4px); background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none; }
.tse-search:focus { border-color: var(--tse-ring); }
.tse-swatches { display: grid; grid-template-columns: repeat(5, 24px); gap: 6px; padding: 6px; }
.tse-swatch { width: 24px; height: 24px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 999px; cursor: pointer; }
.tse-swatch[data-active] { outline: 2px solid var(--tse-ring); outline-offset: 2px; }
.tse-swatch-none { display: flex; align-items: center; justify-content: center; background: var(--tse-bg); color: var(--tse-muted-fg); font-size: 11px; }
.tse-empty { padding: 10px 8px; color: var(--tse-muted-fg); font-size: 13px; }

/* Component panels */
.tse-panel {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 260px;
  padding: 10px;
  border: 1px solid var(--tse-border);
  border-radius: var(--tse-radius);
  background: var(--tse-popover);
  box-shadow: 0 10px 38px -10px rgb(0 0 0 / 0.25), 0 10px 20px -15px rgb(0 0 0 / 0.15);
  animation: tse-in 120ms ease-out;
}
.tse-panel-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.tse-panel-title svg { width: 15px; height: 15px; }
.tse-panel-title .tse-button { margin-left: auto; }
.tse-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--tse-muted-fg); }
.tse-field input[type="text"], .tse-field input[type="number"], .tse-field select, .tse-field textarea {
  width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--tse-border);
  border-radius: calc(var(--tse-radius) - 4px);
  background: transparent;
  color: var(--tse-fg);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.tse-field textarea { min-height: 54px; resize: vertical; font-family: ui-monospace, monospace; }
.tse-field input:focus, .tse-field select:focus, .tse-field textarea:focus { border-color: var(--tse-ring); }
.tse-field-row { display: flex; align-items: center; gap: 8px; color: var(--tse-fg); font-size: 13px; }
.tse-field small { color: var(--tse-muted-fg); }
.tse-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.tse-actions .tse-button { border: 1px solid var(--tse-border); height: 28px; font-size: 12px; }
.tse-math-keys { display: flex; flex-wrap: wrap; gap: 4px; }
.tse-math-keys .tse-button { border: 1px solid var(--tse-border); height: 26px; min-width: 32px; font-size: 12px; font-family: ui-serif, serif; }

/* Table controls: + buttons at the edges of the caret's row and column */
.tse-edge {
  position: fixed;
  z-index: 35;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--tse-border);
  border-radius: 999px;
  background: var(--tse-popover);
  color: var(--tse-fg);
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.12);
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 120ms, transform 120ms;
}
.tse-edge:hover { opacity: 1; transform: scale(1.1); background: var(--tse-primary); color: var(--tse-primary-fg); }
.tse-edge svg { width: 12px; height: 12px; }
.tse-pages { min-width: 0; }
.tse-status { margin-top: 6px; color: var(--tse-muted-fg); font-size: 12px; }

@media (prefers-color-scheme: dark) {
  .tse-root:where(:not(.light *)), .tse-layer:where(:not(.light *)) {
    --tse-bg: var(--background, #0a0a0a);
    --tse-fg: var(--foreground, #fafafa);
    --tse-muted: var(--muted, #27272a);
    --tse-muted-fg: var(--muted-foreground, #a1a1aa);
    --tse-accent: var(--accent, #27272a);
    --tse-accent-fg: var(--accent-foreground, #fafafa);
    --tse-border: var(--border, #27272a);
    --tse-popover: var(--popover, #18181b);
    --tse-popover-fg: var(--popover-foreground, #fafafa);
    --tse-primary: var(--primary, #fafafa);
    --tse-primary-fg: var(--primary-foreground, #18181b);
  }
}
@media (prefers-reduced-motion: reduce) { .tse-floating, .tse-popover, .tse-panel { animation: none; } }
@media print { .tse-fixed, .tse-floating, .tse-panel, .tse-edge, .tse-popover { display: none !important; } }
`;

const SHEET = Symbol.for("typstream.editor-react.css");

/** Adds the editor's CSS to the document once. */
export const ensureEditorStyles = (doc: Document): void => {
  const holder = doc as Document & { [SHEET]?: true };
  if (holder[SHEET]) return;
  holder[SHEET] = true;
  if ("adoptedStyleSheets" in doc && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(EDITOR_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement("style");
    style.textContent = EDITOR_CSS;
    doc.head.append(style);
  }
};
