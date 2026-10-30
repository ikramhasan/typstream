"use client";
// A chat whose answers are Typst documents: useChat streams the model's
// answers, and each one renders as a <Typstream> (@typstream/ai's isStreaming
// says whether it is still being written). It heals every prefix so it
// compiles, keeps the last good render while one doesn't, and finishes the
// document (strict compile, no caret) once the answer is complete. All answers
// share one engine worker; only visible or streaming ones compile. <Telemetry>
// wires typstream's events to the console and an analytics sink. The model
// writes with @typstream/edu's vocabulary (the route's prompt), so answers
// render with its plugin; "Show answers" turns on the teacher's copy. Images
// come from the model's Wikimedia Commons searches (app/api/chat/images.ts),
// fetched here by `fetchImages`.
//
// The chat around it is built from shadcn/ui's AI Elements patterns (Chat,
// Message, Prompt Input, Suggestion): Message Scroller follows the answer while
// you stay at the bottom and lets you scroll away from it. As pages, an answer
// is cut off below the text being written, so that bottom is the text.
//
// Documents can be edited (#34). Each answer's Edit button asks what to change
// and edits that document in place; once there's a document, a request typed in
// the chat edits the latest one in a new answer. Either way the page sends the
// document with the request, the model answers with `<edit>`s that quote what
// they replace, and an edit session (@typstream/ai) applies them as they stream:
// a block being rewritten streams into place while the rest stays, in HTML the
// text a quote matches is highlighted, then Keep or Undo.
//
// Edit visually opens the document in the visual editor (#36, app/visual-editor.tsx): Typst as rich text
// with Plate's toolbars, beside its pages. Done makes the edited text the document, as a kept edit does, so a
// request typed next edits it; the editor's Ask AI opens the Edit field with the selected text.
//
// A deployment has no Anthropic key of its own: when the route says so, a
// dialog asks for the visitor's (app/api/chat/key.ts). It stays in this page's
// memory, goes with each request, and is gone when the page closes; without
// one, the route replays a recorded worksheet.

import { useChat } from "@ai-sdk/react";
import {
  blockStarts,
  createEditSession,
  type EditSession,
  type EditSessionState,
  editFeedback,
  isStreaming,
  textOf,
} from "@typstream/ai";
import { edu, SHOW_ANSWERS_INPUT } from "@typstream/edu";
import { googleFonts } from "@typstream/google-fonts";
import { mindmap } from "@typstream/mindmap";
import { mindmapIslands } from "@typstream/mindmap/react";
import { DefaultChatTransport, readUIMessageStream, type UIDataTypes, type UIMessage } from "ai";
import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  FileDownIcon,
  FileTextIcon,
  FileTypeIcon,
  ImageIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PencilIcon,
  RotateCwIcon,
  SquareIcon,
  SquarePenIcon,
  TextCursorInputIcon,
  Undo2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type DocumentState, fetchImages, Typstream, type TypstreamInfo, useTypstream } from "typstream";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatTools } from "./api/chat/images";
import { type ChatConfig, KEY_HEADER } from "./api/chat/key";
import type { ChatMetadata } from "./api/chat/route";
import { Telemetry } from "./telemetry";

/** The visual editor, downloaded (Plate and Typst's parser) the first time a teacher opens it. */
const VisualEditor = dynamic(() => import("./visual-editor"), { ssr: false });

type Target = "html" | "paged";

const TARGETS = [
  { label: "HTML", value: "html" },
  { label: "Pages", value: "paged" },
] satisfies { label: string; value: Target }[];

/**
 * The vocabulary and fonts the route's prompt teaches: edu, any Google Fonts family, which the
 * engine downloads from jsDelivr the first time an answer names it, and mind maps. A constant: a new
 * array would reopen every answer.
 */
const PLUGINS = [edu, googleFonts, mindmap];

/**
 * The images the model's searches found: resized ones on thumb.wikimedia.org, small originals on
 * upload.wikimedia.org. Both send CORS headers, so no proxy. Only these hosts: a model can be
 * steered into writing an image URL that carries what it read to someone else's server. One
 * resolver for every answer, so each image downloads once.
 */
const IMAGES = fetchImages({ hosts: ["thumb.wikimedia.org", "upload.wikimedia.org"] });

/**
 * Messages with the route's tools (an image search shows up as a `tool-searchImages` part) and, on
 * a request to edit, the document it edits.
 */
type ChatMessage = UIMessage<ChatMetadata, UIDataTypes, ChatTools>;
type ImageSearchPart = Extract<ChatMessage["parts"][number], { type: "tool-searchImages" }>;
/** edu's answers (blanks filled in, worked answers, answer keys) appear only with this input. */
const ANSWERS = { [SHOW_ANSWERS_INPUT]: "true" };

type Suggestion = { label: string; prompt: string };

/**
 * One request per thing edu and its Universe packages can write, to try each with a click. Most are
 * tools/llm-corpus's requests (src/requests.mjs), the ones the prompt kit was measured on; number
 * lines, graph paper, photos (the image search), mind maps and the fletcher, cetz-plot and alchemist
 * ones are new.
 */
const SUGGESTIONS: { group: string; items: Suggestion[] }[] = [
  {
    group: "Templates",
    items: [
      {
        label: "Worksheet",
        prompt:
          "A grade 7 science worksheet on photosynthesis with fill-in-the-blank, multiple choice and one question where students label a diagram of a leaf.",
      },
      { label: "Quiz", prompt: "A 10-question multiple-choice quiz on European capitals for grade 6." },
      {
        label: "Exam",
        prompt:
          "A 90-minute Algebra II final exam in three sections (multiple choice, short answer, extended response) with points for each question and an answer key.",
      },
      {
        label: "Handout",
        prompt: "A handout explaining the Pythagorean theorem, with a labelled right triangle and a worked example.",
      },
      { label: "Lesson plan", prompt: "A 45-minute lesson plan for grade 4 on the water cycle." },
      { label: "Rubric", prompt: "A rubric for an argumentative essay with 4 criteria and 4 performance levels." },
    ],
  },
  {
    group: "Questions and answers",
    items: [
      {
        label: "True or false",
        prompt: "A true/false quiz on cell biology for grade 9: 12 statements, with the answers.",
      },
      {
        label: "Matching",
        prompt: "A beginner Spanish vocabulary quiz on food: a matching section and a fill-in-the-blank section.",
      },
      {
        label: "Room for working",
        prompt:
          "A grade 8 worksheet on solving linear equations in one variable, getting harder as it goes, with room for working.",
      },
      {
        label: "Written answers",
        prompt:
          "A grade 5 reading comprehension worksheet: a short original story (about 250 words) followed by 6 questions.",
      },
      {
        label: "Worked solutions",
        prompt: "A 60-minute calculus midterm on limits and derivatives, with worked solutions for the teacher.",
      },
    ],
  },
  {
    group: "Drawings and science",
    items: [
      {
        label: "Coordinate plane",
        prompt: "A grade 7 worksheet on plotting points in the coordinate plane and reading coordinates off a grid.",
      },
      {
        label: "Number line",
        prompt: "A grade 6 worksheet on adding and subtracting negative numbers, using number lines.",
      },
      {
        label: "Graph paper",
        prompt: "A grade 5 worksheet where students draw a bar chart of a class survey on graph paper.",
      },
      {
        label: "Line graph",
        prompt:
          "A grade 8 worksheet on reading a line graph of a city's temperature over one week, with the graph plotted.",
      },
      {
        label: "Diagram",
        prompt: "A grade 7 handout on food chains in a pond, with a diagram of arrows showing who eats whom.",
      },
      {
        label: "Chemical equations",
        prompt: "A grade 9 chemistry worksheet: balance 10 chemical equations, from easy to hard, with an answer key.",
      },
      {
        label: "Molecules",
        prompt: "A grade 11 chemistry handout on alkanes, with the skeletal structures of methane to pentane.",
      },
      { label: "Units", prompt: "A short grade 10 physics quiz on SI units and unit conversions." },
      {
        label: "Photos",
        prompt: "A grade 6 geography handout on the New Seven Wonders of the World, with a photo of each.",
      },
    ],
  },
  {
    // @typstream/mindmap: interactive in the HTML target (pan, zoom, open and close branches), the
    // Typst drawing as pages and in exports.
    group: "Mind maps",
    items: [
      { label: "Mind map", prompt: "A mind map of photosynthesis for grade 7, standard depth, as a teaching aid." },
      {
        label: "Revision map",
        prompt:
          "A detailed, text-focused revision mind map of the causes of World War I for grade 10, with a colour per kind of cause and the immediate trigger in red.",
      },
      {
        label: "Map with photos",
        prompt: "A visual mind map of the water cycle for grade 4, with photos on the main stages.",
      },
    ],
  },
  {
    group: "Languages and fonts",
    items: [
      { label: "Arabic", prompt: "A short multiple-choice quiz in Arabic for grade 4 on the solar system." },
      { label: "Bengali", prompt: "A grade 3 multiplication quiz in Bengali, 8 questions." },
      {
        label: "Fonts",
        prompt:
          "A grade 2 handwriting practice sheet on animal names, in a friendly handwritten font with rounded headings.",
      },
    ],
  },
];

/** Once there's a document, requests edit it: these are changes a teacher asks for. */
const EDIT_SUGGESTIONS: Suggestion[] = [
  { label: "Harder", prompt: "Make the practice questions a little harder." },
  { label: "One more question", prompt: "Add one more question at the end of the practice, in the same style." },
  { label: "Simpler words", prompt: "Rewrite the explanations in simpler words for younger students." },
  { label: "Fix a mistake", prompt: "Check the worked example and fix it if anything is wrong." },
];

/**
 * The document in an answer: its text after the last image search. The model is told to search
 * first and write nothing before the document, so anything it says before a search is chatter, not
 * Typst; and one answer is one document even if its text comes in several parts.
 */
const documentOf = (message: ChatMessage) => {
  const searches = message.parts.map((part, i) => (part.type === "tool-searchImages" ? i : -1));
  return textOf({ ...message, parts: message.parts.slice(Math.max(...searches) + 1) });
};

/** The document an answer edits: the one its request was sent with, if any. */
const editOf = (messages: readonly ChatMessage[], index: number): string | undefined => {
  const request = messages[index - 1];
  return request?.role === "user" ? request.metadata?.document : undefined;
};

/** One image search: what it's looking for while it runs, then what it found. */
const ImageSearch = ({ part }: { part: ImageSearchPart }) => {
  const query = part.input?.query ? `“${part.input.query}”` : "images";
  let text = `Searching Wikimedia Commons for ${query}…`;
  if (part.state === "output-available") {
    const output = part.output;
    text =
      "error" in output
        ? `Image search for ${query} failed: ${output.error}`
        : `Found ${output.images.length} images for ${query} on Wikimedia Commons`;
  } else if (part.state === "output-error") {
    text = `Image search for ${query} failed: ${part.errorText}`;
  }
  const running = part.state === "input-streaming" || part.state === "input-available";
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ImageIcon className="size-3.5 shrink-0" />
      <span className={running ? "shimmer" : undefined}>{text}</span>
    </p>
  );
};

/** A ghost icon button with a tooltip, as Message's actions are. */
const Action = ({ label, onClick, disabled, children }: ActionProps) => (
  <Tooltip>
    <TooltipTrigger
      render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} />}
    >
      {children}
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

type ActionProps = { label: string; onClick: () => void; disabled?: boolean; children: ReactNode };

type CopySourceProps = { target: Target; text: string; exportHtml: TypstreamInfo["exportHtml"]; disabled: boolean };

/**
 * Copies the answer in the view's form: as pages, its Typst source; as HTML, the file
 * `useTypstream().exportHtml()` makes (the export with edu's CSS, the theme and the fonts the answer
 * uses), which opens on its own. The HTML is a promise in a ClipboardItem, since Safari copies only
 * within the click, not after an await.
 */
const CopySource = ({ target, text, exportHtml, disabled }: CopySourceProps) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const what = target === "html" ? "HTML" : "Typst source";
  const label = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : `Copy ${what}`;
  const copy = () => {
    const content = target === "html" ? exportHtml() : Promise.resolve(text);
    return typeof ClipboardItem === "undefined"
      ? content.then((t) => navigator.clipboard.writeText(t))
      : navigator.clipboard.write([
          new ClipboardItem({ "text/plain": content.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
  };
  return (
    <Action
      label={label}
      disabled={disabled}
      onClick={() => {
        copy()
          .then(() => setState("copied"))
          .catch((e: unknown) => {
            console.error(`[typstream] copying the ${what} failed:`, e);
            setState("failed");
          })
          .finally(() => setTimeout(() => setState("idle"), 2000));
      }}
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
    </Action>
  );
};

/** A file name from the document's title (an edu template's `title:` or the first heading). */
const fileName = (source: string, extension: string) => {
  const title = /title:\s*\[([^\]\n]+)\]/.exec(source)?.[1] ?? /^=+\s+(.+)$/m.exec(source)?.[1] ?? "document";
  const name = title
    .replace(/[*_#$\\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${name || "document"}.${extension}`;
};

type ExportFormat = "pdf" | "html" | "docx";

const FORMATS: Record<ExportFormat, { what: string; type: string }> = {
  pdf: { what: "PDF", type: "application/pdf" },
  html: { what: "HTML", type: "text/html" },
  docx: { what: "Word (.docx)", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

type ExportProps = { format: ExportFormat; source: string; disabled: boolean; children: ReactNode } & Pick<
  TypstreamInfo,
  "exportPdf" | "exportHtml" | "exportDocx"
>;

/**
 * Downloads the answer, compiled in final mode with the component's `inputs`, so with "Show answers"
 * on it's the teacher's copy too. A PDF (`useTypstream().exportPdf()`) has the pages the preview
 * shows (fit-width only scales them); HTML is the file `exportHtml()` makes (edu's CSS, the theme
 * and the fonts the answer uses), which opens on its own; a Word file (`exportDocx()`, beta) is an
 * editable DOCX laid out as the PDF, whichever view is shown (a mind map is a picture in it).
 */
const Export = ({ format, exportPdf, exportHtml, exportDocx, source, disabled, children }: ExportProps) => {
  const [state, setState] = useState<"idle" | "exporting" | "failed">("idle");
  const { what, type } = FORMATS[format];
  const label = state === "exporting" ? "Exporting…" : state === "failed" ? "Export failed" : `Export ${what}`;
  const file = (): Promise<Blob> =>
    (format === "html" ? exportHtml() : format === "docx" ? exportDocx() : exportPdf()).then(
      (content) => new Blob([content as BlobPart], { type }),
    );
  return (
    <Action
      label={label}
      disabled={disabled || state === "exporting"}
      onClick={() => {
        setState("exporting");
        file()
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const download = fileName(source, format);
            Object.assign(window.document.createElement("a"), { href: url, download }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setState("idle");
          })
          .catch((e: unknown) => {
            console.error(`[typstream] ${what} export failed:`, e);
            setState("failed");
            setTimeout(() => setState("idle"), 3000);
          });
      }}
    >
      {state === "exporting" ? <LoaderCircleIcon className="animate-spin" /> : children}
    </Action>
  );
};

/** Page headers and footers sit in the margins; the text being written never does. */
const MARGIN = 0.08;

/**
 * Where the text being written is: the last run, in reading order, on the last page with text in its
 * body. `y` is in the page's points, from its top. (As the website's live demo finds it.)
 */
function streamPosition(state: DocumentState | null): { page: number; y: number; height: number } | null {
  const artifact = state?.artifact;
  if (artifact?.target !== "paged") return null;
  for (let i = artifact.pages.length - 1; i >= 0; i--) {
    const page = artifact.pages[i];
    const body = page?.text?.filter((run) => run.y > page.height * MARGIN && run.y < page.height * (1 - MARGIN));
    const run = body?.[body.length - 1];
    if (page && run) return { page: page.index, y: run.y, height: page.height };
  }
  return null;
}

/** How much of the page shows below the line being written, in points: about two lines. */
const BELOW = 36;

/**
 * While an answer streams as pages, the height to cut it off at: just below the text being written.
 * Typst adds a whole page as soon as it starts one, mostly blank, and the scroller follows the bottom
 * of the content; cut off, the bottom is the text, and the page grows as it's written. `null` shows
 * everything (HTML, or the answer is complete).
 */
function useStreamClip(state: DocumentState | null, streaming: boolean, target: Target) {
  const host = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState<number | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const measure = useCallback(() => {
    const el = host.current;
    if (!el || !streaming || target !== "paged") return setClip(null);
    const position = streamPosition(latest.current);
    const page = position && el.querySelector(`.typstream-page[data-page="${position.page + 1}"]`);
    // No text yet: show the top of the first page, not a blank sheet.
    if (!page) return setClip((clip) => clip ?? 48);
    const rect = page.getBoundingClientRect();
    const y = rect.top - el.getBoundingClientRect().top + ((position.y + BELOW) / position.height) * rect.height;
    setClip(Math.ceil(y));
  }, [streaming, target]);
  useLayoutEffect(measure, [measure]);
  return { host, clip, measure };
}

type Mark = { from: number; to: number; kind: "quoting" | "writing" | "changed" };

/**
 * Highlights the top-level blocks of an HTML render that `marks` touch. A block's elements carry its
 * offset in the compiled source (`data-typstream-src`), mapped back to the text with heal's map.
 * While a block streams, the render on screen is an earlier compile's than the text, so offsets
 * after it don't match: the blocks being written are then the ones between the blocks before the
 * streaming range and the blocks after it, counted from either end. Pages have no anchors: there
 * the footer says what the edit is doing.
 */
const highlight = (
  root: HTMLElement | null,
  state: DocumentState | null,
  marks: readonly Mark[],
  text: string,
  streamingRange: { from: number; to: number } | null,
) => {
  if (!root || !state) return;
  const elements = [...root.querySelectorAll<HTMLElement>("[data-typstream-src]")];
  const blocks = [...new Set(elements.map((element) => element.dataset.typstreamSrc as string))];
  const offsets = blocks.map((src) => state.heal.map.toInput(Number(src)));
  const starts = streamingRange ? blockStarts(text) : [];
  const before = starts.filter((at) => streamingRange && at < streamingRange.from).length;
  const after = starts.filter((at) => streamingRange && at >= streamingRange.to).length;
  const kinds = blocks.map((_, i) => {
    if (streamingRange) return i >= before && i < blocks.length - after ? "writing" : undefined;
    const from = offsets[i] as number;
    const to = offsets[i + 1] ?? Number.POSITIVE_INFINITY;
    return marks.find((m) => (m.from < to && m.to > from) || (m.from === m.to && m.from >= from && m.from < to))?.kind;
  });
  for (const element of elements) {
    const kind = kinds[blocks.indexOf(element.dataset.typstreamSrc as string)];
    if (kind) element.dataset.edit = kind;
    else delete element.dataset.edit;
  }
};

type AnswerProps = {
  text: string;
  streaming: boolean;
  /** For an edit: the part being rewritten (the rest of the document is finished). */
  streamingRange?: { from: number; to: number } | null;
  /** For an edit: what to highlight (HTML only). */
  marks?: readonly Mark[];
  target: Target;
  answers: boolean;
  busy: boolean;
  onRetry: () => void;
  /** More of the footer: Edit, and an edit's Keep and Undo. */
  children?: ReactNode;
  /** Below the footer: what the model said about its edits, the field asking what to change. */
  after?: ReactNode;
};

const Answer = ({
  text,
  streaming,
  streamingRange,
  marks,
  target,
  answers,
  busy,
  onRetry,
  children,
  after,
}: AnswerProps) => {
  const t = useTypstream();
  // Compiles that failed while streaming. The last good render stays on screen, so a reader never
  // sees them; the smoke test checks there were none.
  const [stale, setStale] = useState(0);
  const frame = t.openFrames[0]?.frame;
  // An edit streams into the middle of the document: nothing below it to cut off.
  const { host, clip, measure } = useStreamClip(t.state, streaming && !streamingRange, target);
  const mark = useCallback(
    () => highlight(t.handle?.element ?? null, t.state, marks ?? [], text, streamingRange ?? null),
    [t, marks, text, streamingRange],
  );
  useLayoutEffect(mark, [mark]);
  return (
    <Message>
      <MessageContent>
        <article
          // HTML in a card; pages on their own, as sheets with shadows (app/globals.css), inset so the
          // chat's scroll area doesn't cut the shadows off at the sides.
          className={
            target === "paged" ? "answer px-4 pt-2 pb-8" : "answer rounded-xl border bg-card px-8 py-6 shadow-xs"
          }
          data-status={t.status}
          data-stale={stale}
          data-target={target}
        >
          <div
            ref={host}
            // Clipped vertically only: the pages' shadows stay at their sides while the answer streams.
            className={clip === null ? undefined : "overflow-y-clip"}
            style={clip === null ? undefined : { height: clip }}
          >
            <Typstream
              ref={t.ref}
              source={text}
              isStreaming={streaming}
              streamingRange={streamingRange}
              target={target}
              plugins={PLUGINS}
              // A mind map is interactive in the HTML target (pan, zoom, open and close branches): React Flow,
              // loaded the first time an answer has one. Pages show its drawing.
              islands={mindmapIslands}
              resolveImage={IMAGES}
              inputs={answers ? ANSWERS : undefined}
              layout="fit-width"
              animated
              caret
              onRendered={() => {
                measure();
                mark();
              }}
              onStatusChange={(status) => {
                if (status === "stale" || status === "error") setStale((n) => n + 1);
              }}
            />
          </div>
        </article>
        <MessageFooter className="gap-1 px-0">
          <CopySource target={target} text={text} exportHtml={t.exportHtml} disabled={streaming} />
          <Export
            format={target === "html" ? "html" : "pdf"}
            exportPdf={t.exportPdf}
            exportHtml={t.exportHtml}
            exportDocx={t.exportDocx}
            source={text}
            disabled={streaming}
          >
            <FileDownIcon />
          </Export>
          <Export
            format="docx"
            exportPdf={t.exportPdf}
            exportHtml={t.exportHtml}
            exportDocx={t.exportDocx}
            source={text}
            disabled={streaming}
          >
            <FileTypeIcon />
          </Export>
          <Action label="Retry" onClick={onRetry} disabled={busy}>
            <RotateCwIcon />
          </Action>
          {children}
          <span className={streaming ? "shimmer ml-2" : "ml-2"}>
            {t.status}
            {streaming && frame ? ` · writing a ${frame}…` : ""}
            {t.diagnostics.length ? ` · ${t.diagnostics.length} diagnostics` : ""}
          </span>
        </MessageFooter>
        {after}
      </MessageContent>
    </Message>
  );
};

/** What an edit session's state highlights: the text quotes match, the block being written, then what changed. */
const marksOf = (state: EditSessionState): Mark[] =>
  state.edits.flatMap((edit): Mark[] => {
    if (!edit.range) return [];
    if (edit.status === "quoting" || edit.status === "writing") return [{ ...edit.range, kind: edit.status }];
    return edit.status === "applied" && state.phase === "review" ? [{ ...edit.range, kind: "changed" }] : [];
  });

/**
 * The visitor's Anthropic key, when the server has none: in memory only, never stored, and sent with each
 * request. Module state, since the chat and the edits made in place send through the same transport.
 */
let visitorKey = "";

/**
 * Where the chat and an edit made in place are sent: the chat's route, which edits the document a request
 * carries. Headers are read on each request, so a key entered later goes with the next one.
 */
const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  headers: (): Record<string, string> => (visitorKey ? { [KEY_HEADER]: visitorKey } : {}),
});

/**
 * Asks for the visitor's Anthropic key. Use sets it for the requests that follow; Replay a sample (or no key)
 * leaves the route replaying its recorded worksheet.
 */
const KeyDialog = ({
  open,
  onOpenChange,
  onKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKey: (key: string) => void;
}) => {
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            onKey(value.trim());
            setValue("");
          }}
        >
          <DialogHeader>
            <DialogTitle>Your Anthropic API key</DialogTitle>
            <DialogDescription>
              This demo asks Claude with your key. It stays in this tab's memory and goes only with your requests: it
              isn't saved, and closing the page forgets it. Without one, a recorded worksheet replays.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            aria-label="Anthropic API key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onKey("")}>
              Replay a sample
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              Use key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const NO_SESSION = () => () => {};
const NO_STATE = () => null;

/** Asks what to change in a document: Enter applies it, Escape closes the field. */
type EditFieldProps = {
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
  /** What the field starts with (the visual editor's Ask AI puts the selected text in). */
  initial?: string;
};

const EditField = ({ onSubmit, onCancel, initial = "" }: EditFieldProps) => {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          // The field opens because the reader asked to type in it.
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What should change in this document?"
          aria-label="Edit instruction"
          className="min-h-12"
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="sm" onClick={onCancel}>
            Cancel
          </InputGroupButton>
          <InputGroupButton type="submit" variant="default" size="sm" className="ml-auto" disabled={!value.trim()}>
            Edit
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
};

type DocumentAnswerProps = Omit<AnswerProps, "streamingRange" | "marks" | "children" | "after"> & {
  /** The answer's message id: its edits made in place are kept under it. */
  id: string;
  /** For an answer to an edit request typed in the chat: its session, and the answer that feeds it. */
  answer?: { session: EditSession; text: string; done: boolean };
  /** The chat up to this answer: what an edit made in place is asked with. */
  history: readonly ChatMessage[];
  /** Each answer's latest edit session, by id: the page's, so a request typed next edits the latest text. */
  latest: Map<string, EditSession>;
};

/**
 * A document in the chat: the answer's own (`text`, streaming as the answer does), or the one an
 * edit request's answer changed. Edit asks what to change and edits this document in place: a
 * session over its text, fed by a request sent beside the chat. A stopped edit rolls back the
 * part it was writing; the last edit ends with Keep or Undo.
 */
const DocumentAnswer = ({ id, text, streaming, answer, history, latest, ...props }: DocumentAnswerProps) => {
  // The session that last changed this document: the answer's own, then each edit made in place.
  const [session, setSession] = useState<EditSession | null>(() => latest.get(id) ?? answer?.session ?? null);
  const state = useSyncExternalStore(
    session?.subscribe ?? NO_SESSION,
    session?.getState ?? NO_STATE,
    session?.getState ?? NO_STATE,
  );
  const { session: answerSession, text: answerText, done: answerDone } = answer ?? {};
  useEffect(() => answerSession?.update(answerText ?? "", answerDone), [answerSession, answerText, answerDone]);
  const [asking, setAsking] = useState(false);
  // The Edit field's first text, from the visual editor's Ask AI.
  const [prefill, setPrefill] = useState("");
  const [visual, setVisual] = useState(false);
  const [running, setRunning] = useState<AbortController | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const edit = async (instruction: string) => {
    if (state?.phase === "review") session?.keep();
    const document = state?.text ?? text;
    const next = createEditSession(document);
    latest.set(id, next);
    setSession(next);
    setAsking(false);
    setFailure(null);
    const controller = new AbortController();
    setRunning(controller);
    let reply = "";
    try {
      const stream = await transport.sendMessages({
        chatId: `edit-${id}`,
        messages: [
          ...history,
          {
            id: `${id}-edit-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: instruction }],
            metadata: { document },
          },
        ],
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: controller.signal,
      });
      for await (const message of readUIMessageStream<ChatMessage>({ stream })) {
        reply = textOf(message);
        next.update(reply);
      }
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    }
    // Ended, stopped or failed: an edit still being written is rolled back.
    next.update(reply, true);
    setRunning(null);
  };

  /**
   * The visual editor's text becomes the document: a session with no edits of its own, kept at once, so
   * the answer shows it and a request typed next (or Edit) edits it.
   */
  const commit = (edited: string) => {
    const current = state?.text ?? text;
    if (edited === current) return;
    if (state?.phase === "review") session?.keep();
    const next = createEditSession(edited);
    next.update("", true);
    next.keep();
    latest.set(id, next);
    setSession(next);
  };

  const writing = streaming || running !== null || state?.phase === "streaming";
  const doing = state?.edits.find((e) => e.status === "quoting" || e.status === "writing");
  const feedback = state && state.phase !== "streaming" ? editFeedback(state.edits) : null;
  const failed = state?.edits.filter((e) => e.status === "failed").length ?? 0;
  return (
    <Answer
      {...props}
      text={state?.text ?? text}
      streaming={state ? state.streaming : streaming}
      streamingRange={state?.streamingRange ?? null}
      marks={state ? marksOf(state) : undefined}
      after={
        <>
          {state?.message && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{state.message}</p>}
          {failure && <p className="text-sm text-destructive">The edit failed: {failure}</p>}
          {asking && (
            <EditField
              initial={prefill}
              onSubmit={(instruction) => void edit(instruction)}
              onCancel={() => setAsking(false)}
            />
          )}
          {visual && (
            <VisualEditor
              source={state?.text ?? text}
              plugins={PLUGINS}
              onDone={(edited) => {
                commit(edited);
                setVisual(false);
              }}
              onAskAI={(edited, request) => {
                commit(edited);
                setVisual(false);
                setPrefill(request.text.trim() ? `In “${request.text.trim()}”: ` : "");
                setAsking(true);
              }}
            />
          )}
        </>
      }
    >
      <Action
        label="Edit"
        onClick={() => {
          setPrefill("");
          setAsking((open) => !open);
        }}
        disabled={writing}
      >
        <PencilIcon />
      </Action>
      <Action label="Edit visually" onClick={() => setVisual(true)} disabled={writing}>
        <TextCursorInputIcon />
      </Action>
      {running && (
        <Button size="sm" variant="outline" className="ml-2" onClick={() => running.abort()}>
          <SquareIcon data-icon="inline-start" />
          Stop
        </Button>
      )}
      {state?.phase === "review" && !running && (
        <>
          <Button size="sm" className="ml-2" onClick={() => session?.keep()}>
            <CheckIcon data-icon="inline-start" />
            Keep
          </Button>
          <Button size="sm" variant="outline" onClick={() => session?.undo()}>
            <Undo2Icon data-icon="inline-start" />
            Undo
          </Button>
        </>
      )}
      {feedback && !running && (
        <Button size="sm" variant="ghost" onClick={() => void edit(feedback)}>
          <RotateCwIcon data-icon="inline-start" />
          {failed === 1 ? "Redo the edit that failed" : `Redo ${failed} edits that failed`}
        </Button>
      )}
      {state?.phase === "undone" && <span className="ml-2">Undone</span>}
      {doing && (
        <span className="shimmer ml-2">
          {doing.status === "quoting" ? "Finding the text to change…" : "Rewriting…"}
        </span>
      )}
    </Answer>
  );
};

/** A suggestion: its label on the button, its request (also the tooltip) sent on click. */
const SuggestionButton = ({ item, onSend, disabled, className }: SuggestionButtonProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          variant="outline"
          size="sm"
          className={className}
          disabled={disabled}
          onClick={() => onSend(item.prompt)}
        />
      }
    >
      {item.label}
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">{item.prompt}</TooltipContent>
  </Tooltip>
);

type SuggestionButtonProps = {
  item: Suggestion;
  onSend: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
};

export default function Page() {
  const chat = useChat<ChatMessage>({ transport });
  const { messages, setMessages, sendMessage, regenerate, stop, status, error } = chat;
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target>("paged");
  const [answers, setAnswers] = useState(false);
  // Whether to ask for a key (only when the server has none), whether the dialog is open, and whether one is set.
  const [askForKey, setAskForKey] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    void fetch("/api/chat")
      .then((response) => response.json() as Promise<ChatConfig>)
      .then(({ serverKey }) => {
        setAskForKey(!serverKey);
        setKeyDialog(!serverKey);
      });
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  const busy = status === "submitted" || status === "streaming";
  // One edit session per answer to an edit request typed in the chat, made the first time it shows,
  // over the document its request was about; and each answer's latest edit made in place.
  const sessions = useRef(new Map<string, EditSession>());
  const latest = useRef(new Map<string, EditSession>());
  const sessionOf = (id: string, document: string) => {
    const session = sessions.current.get(id) ?? createEditSession(document);
    sessions.current.set(id, session);
    return session;
  };

  /** The document as it is now: the latest answer's, with its edits (none, once undone). */
  const currentDocument = (): string | undefined => {
    for (const message of [...messages].reverse()) {
      if (message.role !== "assistant") continue;
      const session = latest.current.get(message.id) ?? sessions.current.get(message.id);
      if (session) return session.getState().text;
      const document = documentOf(message);
      if (document) return document;
    }
    return undefined;
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    // A new request keeps what the last one changed.
    for (const session of [...sessions.current.values(), ...latest.current.values()]) {
      if (session.getState().phase === "review") session.keep();
    }
    const document = currentDocument();
    void sendMessage({ text: text.trim(), metadata: document === undefined ? undefined : { document } });
    setInput("");
  };
  const document = currentDocument();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) void stop();
    else send(input);
  };

  return (
    <Telemetry>
      <MessageScrollerProvider autoScroll>
        <main className="mx-auto flex h-dvh max-w-3xl flex-col">
          <KeyDialog
            open={keyDialog}
            onOpenChange={setKeyDialog}
            onKey={(key) => {
              visitorKey = key;
              setHasKey(key !== "");
              setKeyDialog(false);
            }}
          />
          <header className="flex items-center justify-between gap-4 px-4 py-4">
            <h1 className="font-medium">typstream × AI SDK</h1>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMessages([]);
                  sessions.current.clear();
                  latest.current.clear();
                }}
                disabled={busy}
              >
                <SquarePenIcon data-icon="inline-start" />
                New chat
              </Button>
            )}
            {askForKey && (
              <Button variant="ghost" size="sm" onClick={() => setKeyDialog(true)}>
                <KeyRoundIcon data-icon="inline-start" />
                {hasKey ? "Change key" : "Add key"}
              </Button>
            )}
            <Label className="ml-auto font-normal">
              <Switch checked={answers} onCheckedChange={setAnswers} />
              Show answers
            </Label>
            <Select items={TARGETS} value={target} onValueChange={(value) => value && setTarget(value as Target)}>
              <SelectTrigger size="sm" aria-label="Render as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>

          <div className="min-h-0 flex-1">
            {messages.length === 0 ? (
              <Empty className="h-full justify-start overflow-y-auto">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>What should we write?</EmptyTitle>
                  <EmptyDescription>
                    Ask for a worksheet, quiz, handout or mind map, or try one of the capabilities below. The model
                    writes Typst, and it renders as it streams.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="max-w-2xl gap-4">
                  {SUGGESTIONS.map(({ group, items }) => (
                    <section key={group} className="flex flex-col items-center gap-2">
                      <h2 className="text-xs text-muted-foreground">{group}</h2>
                      <div className="flex flex-wrap justify-center gap-2">
                        {items.map((item) => (
                          <SuggestionButton key={item.label} item={item} onSend={send} />
                        ))}
                      </div>
                    </section>
                  ))}
                </EmptyContent>
              </Empty>
            ) : (
              <MessageScroller>
                {/* No scrollbar: the scroller follows the answer, and its button jumps to the end. Important,
                    since the component's own `scrollbar-thin` sets the same property. */}
                <MessageScrollerViewport className="no-scrollbar!">
                  <MessageScrollerContent aria-busy={busy} className="px-4 pb-4">
                    {messages.map((message, index) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
                        {message.role === "user" ? (
                          <Message align="end">
                            <MessageContent>
                              <Bubble align="end" variant="muted">
                                <BubbleContent className="whitespace-pre-wrap">{textOf(message)}</BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        ) : (
                          <div className="flex flex-col gap-3">
                            {message.parts.map((part, i) =>
                              part.type === "tool-searchImages" ? (
                                // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never reorder.
                                <ImageSearch key={i} part={part} />
                              ) : null,
                            )}
                            {(editOf(messages, index) !== undefined || documentOf(message)) && (
                              <DocumentAnswer
                                id={message.id}
                                text={documentOf(message)}
                                streaming={isStreaming(message, chat)}
                                answer={
                                  editOf(messages, index) === undefined
                                    ? undefined
                                    : {
                                        session: sessionOf(message.id, editOf(messages, index) as string),
                                        text: textOf(message),
                                        done: !isStreaming(message, chat),
                                      }
                                }
                                history={messages.slice(0, index + 1)}
                                latest={latest.current}
                                target={target}
                                answers={answers}
                                busy={busy}
                                onRetry={() => void regenerate({ messageId: message.id })}
                              />
                            )}
                          </div>
                        )}
                      </MessageScrollerItem>
                    ))}
                    {/* Until the first token arrives there's no answer to show: say the model is on it. */}
                    {status === "submitted" && (
                      <MessageScrollerItem>
                        <p className="shimmer text-sm text-muted-foreground">Writing…</p>
                      </MessageScrollerItem>
                    )}
                    {error && (
                      <MessageScrollerItem>
                        <Message>
                          <MessageContent>
                            <Bubble variant="destructive">
                              <BubbleContent>Something went wrong: {error.message}</BubbleContent>
                            </Bubble>
                            <MessageFooter className="px-0">
                              <Button variant="outline" size="sm" onClick={() => void regenerate()}>
                                <RotateCwIcon data-icon="inline-start" />
                                Try again
                              </Button>
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            )}
          </div>

          {/* Once the chat has started, suggestions in a row: changes to the document once there is one, the
              same requests as before until then. Each sends its request in this chat. */}
          {messages.length > 0 && (
            <div className="no-scrollbar flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain px-4 pt-2">
              {(document === undefined ? SUGGESTIONS.flatMap(({ items }) => items) : EDIT_SUGGESTIONS).map((item) => (
                <SuggestionButton key={item.label} item={item} onSend={send} disabled={busy} className="shrink-0" />
              ))}
            </div>
          )}

          <form ref={formRef} onSubmit={onSubmit} className="px-4 pt-2 pb-4">
            <InputGroup>
              <InputGroupTextarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter starts a new line.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) formRef.current?.requestSubmit();
                  }
                }}
                placeholder={document === undefined ? "Ask for a worksheet…" : "Ask for a change…"}
                aria-label="Message"
                className="min-h-14"
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  className="ml-auto rounded-full"
                  disabled={!busy && !input.trim()}
                  aria-label={busy ? "Stop" : "Send"}
                >
                  {busy ? <SquareIcon /> : <ArrowUpIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </main>
      </MessageScrollerProvider>
    </Telemetry>
  );
}
