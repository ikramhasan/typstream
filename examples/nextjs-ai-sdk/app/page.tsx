"use client";
// A chat whose answers are Typst documents: useChat streams the model's text
// parts, and each part renders as a <Typstream>. It heals every prefix so it
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

import { useChat } from "@ai-sdk/react";
import { edu, SHOW_ANSWERS_INPUT } from "@typstream/edu";
import type { UIDataTypes, UIMessage } from "ai";
import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  FileDownIcon,
  FileTextIcon,
  ImageIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  SquareIcon,
  SquarePenIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type DocumentState, fetchImages, Typstream, type TypstreamInfo, useTypstream } from "typstream";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { Telemetry } from "./telemetry";

type Target = "html" | "paged";

const TARGETS = [
  { label: "HTML", value: "html" },
  { label: "Pages", value: "paged" },
] satisfies { label: string; value: Target }[];

/** The vocabulary the route's prompt teaches. A constant: a new array would reopen every answer. */
const PLUGINS = [edu];

/**
 * The images the model's searches found: resized ones on thumb.wikimedia.org, small originals on
 * upload.wikimedia.org. Both send CORS headers, so no proxy. Only these hosts: a model can be
 * steered into writing an image URL that carries what it read to someone else's server. One
 * resolver for every answer, so each image downloads once.
 */
const IMAGES = fetchImages({ hosts: ["thumb.wikimedia.org", "upload.wikimedia.org"] });

/** Messages with the route's tools: an image search shows up as a `tool-searchImages` part. */
type ChatMessage = UIMessage<unknown, UIDataTypes, ChatTools>;
type ImageSearchPart = Extract<ChatMessage["parts"][number], { type: "tool-searchImages" }>;
/** edu's answers (blanks filled in, worked answers, answer keys) appear only with this input. */
const ANSWERS = { [SHOW_ANSWERS_INPUT]: "true" };

type Suggestion = { label: string; prompt: string };

/**
 * One request per thing edu and its Universe packages can write, to try each with a click. Most are
 * tools/llm-corpus's requests (src/requests.mjs), the ones the prompt kit was measured on; number
 * lines, graph paper, photos (the image search) and the fletcher, cetz-plot and alchemist ones are new.
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
    group: "Languages",
    items: [
      { label: "Arabic", prompt: "A short multiple-choice quiz in Arabic for grade 4 on the solar system." },
      { label: "Bengali", prompt: "A grade 3 multiplication quiz in Bengali, 8 questions." },
    ],
  },
];

const textOf = (message: ChatMessage) => message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/**
 * The document in an answer: its text after the last image search. The model is told to search
 * first and write nothing before the document, so anything it says before a search is chatter, not
 * Typst; and one answer is one document even if its text comes in several parts.
 */
const documentOf = (message: ChatMessage) => {
  const searches = message.parts.map((part, i) => (part.type === "tool-searchImages" ? i : -1));
  return message.parts
    .slice(Math.max(...searches) + 1)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
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

const CopySource = ({ text, disabled }: { text: string; disabled: boolean }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Action
      label={copied ? "Copied" : "Copy Typst source"}
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Action>
  );
};

/** A file name from the document's title (an edu template's `title:` or the first heading). */
const fileName = (source: string) => {
  const title = /title:\s*\[([^\]\n]+)\]/.exec(source)?.[1] ?? /^=+\s+(.+)$/m.exec(source)?.[1] ?? "document";
  const name = title
    .replace(/[*_#$\\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${name || "document"}.pdf`;
};

type ExportPdfProps = { document: TypstreamInfo["document"]; source: string; answers: boolean; disabled: boolean };

/**
 * Downloads the answer as PDF. The engine document exports it in final mode at the document's own
 * page size: the export's inputs leave out fit-width's page width, which only sizes the preview.
 * With "Show answers" on, the PDF is the teacher's copy too.
 */
const ExportPdf = ({ document: doc, source, answers, disabled }: ExportPdfProps) => {
  const [state, setState] = useState<"idle" | "exporting" | "failed">("idle");
  const label = state === "exporting" ? "Exporting…" : state === "failed" ? "Export failed" : "Export PDF";
  return (
    <Action
      label={label}
      disabled={disabled || !doc || state === "exporting"}
      onClick={() => {
        if (!doc) return;
        setState("exporting");
        doc
          .exportPdf({ inputs: answers ? ANSWERS : {} })
          .then((bytes) => {
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
            const link = Object.assign(window.document.createElement("a"), { href: url, download: fileName(source) });
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setState("idle");
          })
          .catch((e: unknown) => {
            console.error("[typstream] PDF export failed:", e);
            setState("failed");
            setTimeout(() => setState("idle"), 3000);
          });
      }}
    >
      {state === "exporting" ? <LoaderCircleIcon className="animate-spin" /> : <FileDownIcon />}
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

type AnswerProps = {
  text: string;
  streaming: boolean;
  target: Target;
  answers: boolean;
  busy: boolean;
  onRetry: () => void;
};

const Answer = ({ text, streaming, target, answers, busy, onRetry }: AnswerProps) => {
  const t = useTypstream();
  // Compiles that failed while streaming. The last good render stays on screen, so a reader never
  // sees them; the smoke test checks there were none.
  const [stale, setStale] = useState(0);
  const frame = t.openFrames[0]?.frame;
  const { host, clip, measure } = useStreamClip(t.state, streaming, target);
  return (
    <Message>
      <MessageContent>
        <article
          className="answer rounded-xl border bg-card px-8 py-6 shadow-xs data-[target=paged]:bg-neutral-700 data-[target=paged]:p-4"
          data-status={t.status}
          data-stale={stale}
          data-target={target}
        >
          <div
            ref={host}
            className={clip === null ? undefined : "overflow-hidden"}
            style={clip === null ? undefined : { height: clip }}
          >
            <Typstream
              ref={t.ref}
              source={text}
              isStreaming={streaming}
              target={target}
              plugins={PLUGINS}
              resolveImage={IMAGES}
              inputs={answers ? ANSWERS : undefined}
              layout="fit-width"
              animated
              caret
              onRendered={measure}
              onStatusChange={(status) => {
                if (status === "stale" || status === "error") setStale((n) => n + 1);
              }}
            />
          </div>
        </article>
        <MessageFooter className="gap-1 px-0">
          <CopySource text={text} disabled={streaming} />
          <ExportPdf document={t.document} source={text} answers={answers} disabled={streaming} />
          <Action label="Retry" onClick={onRetry} disabled={busy}>
            <RotateCwIcon />
          </Action>
          <span className={streaming ? "shimmer ml-2" : "ml-2"}>
            {t.status}
            {streaming && frame ? ` · writing a ${frame}…` : ""}
            {t.diagnostics.length ? ` · ${t.diagnostics.length} diagnostics` : ""}
          </span>
        </MessageFooter>
      </MessageContent>
    </Message>
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
  const { messages, setMessages, sendMessage, regenerate, stop, status, error } = useChat<ChatMessage>();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target>("paged");
  const [answers, setAnswers] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    void sendMessage({ text: text.trim() });
    setInput("");
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) void stop();
    else send(input);
  };

  return (
    <Telemetry>
      <MessageScrollerProvider autoScroll>
        <main className="mx-auto flex h-dvh max-w-3xl flex-col">
          <header className="flex items-center justify-between gap-4 px-4 py-4">
            <h1 className="font-medium">typstream × AI SDK</h1>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setMessages([])} disabled={busy}>
                <SquarePenIcon data-icon="inline-start" />
                New chat
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
                    Ask for a worksheet, quiz or handout, or try one of edu's capabilities below. The model writes
                    Typst, and it renders as it streams.
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
                <MessageScrollerViewport>
                  <MessageScrollerContent aria-busy={busy} className="px-4 pb-4">
                    {messages.map((message) => (
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
                            {documentOf(message) && (
                              <Answer
                                text={documentOf(message)}
                                streaming={status === "streaming" && message.id === last?.id}
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

          {/* Once the chat has started, the same suggestions in a row: each sends its request in this chat. */}
          {messages.length > 0 && (
            <div className="no-scrollbar flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain px-4 pt-2">
              {SUGGESTIONS.flatMap(({ items }) => items).map((item) => (
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
                placeholder="Ask for a worksheet…"
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
