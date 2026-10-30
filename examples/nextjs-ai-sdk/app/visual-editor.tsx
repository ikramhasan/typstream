"use client";
// An answer's document in the visual editor (#36): @typstream/editor-react's <TypstEditor> (Plate, with its
// fixed and floating toolbars and slash menu) beside the document's pages, which follow every change. Done
// hands the edited source back to the answer. Ask AI hands the selected text back too, for an edit of the
// chat's kind (the answer's Edit field opens with it). Loaded with next/dynamic, so the chat doesn't download
// Plate until a teacher opens the editor.

import { type AskAIRequest, TypstEditor } from "@typstream/editor-react";
import { type ComponentProps, useState } from "react";
import { htmlCompat, Typstream, universe } from "typstream";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Plugins = NonNullable<ComponentProps<typeof Typstream>["plugins"]>;

type VisualEditorProps = {
  source: string;
  plugins: Plugins;
  /** The edited source (the same text when nothing changed). */
  onDone: (source: string) => void;
  /** "Ask AI" in the editor's toolbars: the source so far and what was selected. */
  onAskAI: (source: string, request: AskAIRequest) => void;
};

export default function VisualEditor({ source, plugins, onDone, onAskAI }: VisualEditorProps) {
  const [text, setText] = useState(source);
  // <Typstream> from typstream adds universe's packages (CeTZ, …) and html-compat itself; the editor's
  // compiled previews (@typstream/react underneath) need them given.
  const [editorPlugins] = useState(() => [universe, htmlCompat, ...plugins]);
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(text)}>
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1600px,calc(100%-2rem))]"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-2">
          <div className="flex min-w-0 flex-col">
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription className="text-xs">
              Type / for blocks, select text for formatting. The pages follow every change.
            </DialogDescription>
          </div>
          <Button size="sm" className="ml-auto" onClick={() => onDone(text)}>
            Done
          </Button>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          <TypstEditor
            className="min-h-0 md:border-r"
            defaultSource={source}
            plugins={editorPlugins}
            onChange={setText}
            onAskAI={(request) => onAskAI(text, request)}
            autoFocus
          />
          <div className="hidden min-h-0 overflow-auto bg-muted/40 p-4 md:block">
            <Typstream source={text} target="paged" plugins={plugins} layout="fit-width" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
