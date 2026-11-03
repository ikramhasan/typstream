// The editor's CSS: its toolbars, on shadcn/ui's variables where the app has them, and what makes Slate's DOM the
// renderer's. Injected with the renderer's own (constructable stylesheets: no `style-src 'unsafe-inline'`).
//
// The editable flow is the renderer's flow (`.typstream-flow`), placed over the same sheets; the laid-out one under it
// is hidden. Browsers' own CSS for `contenteditable` breaks lines otherwise (WebKit keeps spaces at a line's end, which
// moves centred lines; words break anywhere): the flow takes what the hidden one has. Slate wraps each text in spans of its own (`data-slate-leaf`, `data-slate-string`): they take their line
// box from the text around them, as text in the renderer's runs does. Comments stay out of the CSS strings: they would
// ship in every bundle.

/** The editor's stylesheet. @beta */
export const plateCss: string = `
.typstream-plate,
.typstream-plate-floating {
  --tp-bg: var(--background, #fff);
  --tp-fg: var(--foreground, #0a0a0a);
  --tp-muted: var(--muted, #f4f4f5);
  --tp-muted-fg: var(--muted-foreground, #71717a);
  --tp-border: var(--border, #e4e4e7);
  --tp-accent: var(--accent, #f4f4f5);
  --tp-ring: var(--ring, #a1a1aa);
  --tp-radius: var(--radius, 0.5rem);
}
.typstream-plate-toolbar,
.typstream-plate-floating {
  color: var(--tp-fg);
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.typstream-plate {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.typstream-plate-toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--tp-border);
  background: var(--tp-bg);
}
.typstream-plate-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--tp-border);
}
.typstream-plate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  border: 0;
  border-radius: calc(var(--tp-radius) - 2px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.typstream-plate-button:hover {
  background: var(--tp-accent);
}
.typstream-plate-button:focus-visible {
  outline: 2px solid var(--tp-ring);
  outline-offset: -2px;
}
.typstream-plate-button[aria-pressed=true] {
  background: var(--tp-accent);
  color: var(--tp-fg);
}
.typstream-plate-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.typstream-plate-button svg {
  width: 16px;
  height: 16px;
}
.typstream-plate-select {
  height: 32px;
  padding: 0 6px;
  border: 1px solid var(--tp-border);
  border-radius: calc(var(--tp-radius) - 2px);
  background: var(--tp-bg);
  color: inherit;
  font: inherit;
}
.typstream-plate-status {
  margin-left: auto;
  padding: 0 6px;
  color: var(--tp-muted-fg);
  font-size: 12px;
}
.typstream-plate-status[data-error] {
  color: #dc2626;
}
.typstream-plate-floating {
  position: fixed;
  z-index: 50;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-radius);
  background: var(--tp-bg);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}
.typstream-plate-pages {
  position: relative;
  min-height: 0;
}
.typstream-plate-flow {
  outline: none;
  caret-color: #000;
  overflow-wrap: inherit;
  line-break: inherit;
  -webkit-line-break: inherit;
  -webkit-nbsp-mode: inherit;
}
.typstream-plate-flow [data-slate-leaf],
.typstream-plate-flow [data-slate-string],
.typstream-plate-flow [data-slate-length] {
  line-height: inherit;
}
.typstream-plate-flow [data-typed] [data-slate-string] {
  white-space: pre-wrap;
}
.typstream-plate-flow ::selection {
  background: rgb(59 130 246 / 0.25);
}
`;
