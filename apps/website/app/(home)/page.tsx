import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ArrowRight,
  Bot,
  FileText,
  GraduationCap,
  type LucideIcon,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCommand } from "@/components/copy-command";
import { LiveDemo, type Recording } from "@/components/live-demo";
import { description, githubUrl } from "@/lib/shared";

// Real streams from corpus/llm (claude-sonnet with the edu prompt kit), read at build time.
const CORPUS = resolve(process.cwd(), "../../corpus/llm");
const STREAMS: { id: string; label: string; dir?: "rtl" }[] = [
  { id: "kit-v4-sonnet-handout-pythagoras", label: "Pythagoras handout" },
  { id: "kit-v4-sonnet-worksheet-balancing-equations", label: "Chemistry worksheet" },
  { id: "kit-v4-sonnet-arabic-quiz-solar-system", label: "اختبار المجموعة الشمسية", dir: "rtl" },
  { id: "kit-v4-sonnet-bengali-quiz-multiplication", label: "গুণের কুইজ" },
];

function loadRecordings(): Recording[] {
  const meta = JSON.parse(readFileSync(`${CORPUS}/meta.json`, "utf8")) as Record<
    string,
    { prompt?: { request?: string } }
  >;
  return STREAMS.map(({ id, label, dir }) => ({
    id,
    label,
    ...(dir ? { dir } : {}),
    request: meta[id]?.prompt?.request ?? "",
    chunks: readFileSync(`${CORPUS}/${id}.stream.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { t: number; text: string }),
  }));
}

export default function HomePage() {
  const recordings = loadRecordings();
  return (
    <main className="relative flex-1 overflow-x-clip">
      <div className="paper-grid pointer-events-none absolute inset-x-0 top-0 h-[44rem]" aria-hidden />

      <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:pt-24">
        <Link
          href="/docs/concepts/how-it-works"
          className="mb-6 inline-flex items-center gap-2 rounded-full border bg-fd-card/80 px-3 py-1 text-xs text-fd-muted-foreground backdrop-blur hover:text-fd-foreground"
        >
          <span className="size-1.5 rounded-full bg-teal" aria-hidden />
          Typst 0.15.1, compiled to WebAssembly
          <ArrowRight className="size-3" />
        </Link>
        <h1 className="font-display mx-auto max-w-4xl text-5xl leading-[1.04] tracking-tight text-balance sm:text-7xl">
          Typst, rendered while the model is <em className="text-fd-primary">still writing</em>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-fd-muted-foreground text-pretty">{description}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Read the docs <ArrowRight className="size-4" />
          </Link>
          <CopyCommand command="npm install typstream" />
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-24">
        <LiveDemo recordings={recordings} />
        <p className="mt-3 text-center text-xs text-fd-muted-foreground">
          Real Claude streams, replayed at their recorded timing into{" "}
          <code className="font-mono">{'<Typstream target="paged" />'}</code>. Every frame you see compiled.
        </p>
      </section>

      <section className="border-y bg-fd-card/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="font-display mt-3 text-4xl tracking-tight text-balance">
              One unclosed bracket and a Typst document doesn't compile.
            </h2>
            <p className="mt-5 text-fd-muted-foreground">
              Markdown degrades gracefully. Typst is a compiled language: layout, math, tables and scripting, which is
              why teachers' documents look so much better in it, and why half of one fails outright. typstream heals
              every prefix with a faithful port of Typst's own parser, so each token the model writes is a document that
              compiles.
            </p>
            <Link
              href="/docs/concepts/healing"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary hover:underline"
            >
              How healing works <ArrowRight className="size-4" />
            </Link>
          </div>
          <HealDiagram />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-24">
        <div className="max-w-2xl">
          <Eyebrow>What you get</Eyebrow>
          <h2 className="font-display mt-3 text-4xl tracking-tight">Everything between the model and the page.</h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={FileText} title="Two targets, one document" href="/docs/concepts/render-targets">
            Semantic HTML and MathML that reflow and theme, or print-faithful SVG pages with a selectable text layer.
            Only what changed is redrawn.
          </Feature>
          <Feature icon={Workflow} title="Never a blank screen" href="/docs/concepts/fallback">
            Fixers repair what parses but doesn't compile yet; a fallback ladder keeps the last good render, or isolates
            the one block that fails.
          </Feature>
          <Feature icon={ShieldCheck} title="Untrusted by design" href="/docs/guides/security">
            No network, no files you didn't pass, a sanitized DOM, a watchdog for runaway loops. Runs under a strict
            Content-Security-Policy.
          </Feature>
          <Feature icon={GraduationCap} title="A vocabulary for teachers" href="/docs/guides/edu-documents">
            Questions, multiple choice, blanks, rubrics and templates, with answer keys only the teacher's copy shows.
            Arabic and Bengali included.
          </Feature>
          <Feature icon={Server} title="The same engine on the server" href="/docs/getting-started/node">
            Validate before saving, render to PDF, and repair broken documents with your model in a loop. Identical
            output to the preview.
          </Feature>
          <Feature icon={Bot} title="Docs your agent can read" href="/llms.txt">
            Every page as Markdown, an llms.txt index and the full docs in one file, so coding agents integrate
            typstream correctly the first time.
          </Feature>
        </div>
      </section>

      <section className="border-t bg-fd-card/60">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <Eyebrow>One component</Eyebrow>
            <h2 className="font-display mt-3 text-4xl tracking-tight">Pass it the text so far.</h2>
            <p className="mt-5 text-fd-muted-foreground">
              <code className="font-mono text-[0.9em]">{"<Typstream>"}</code> heals, schedules, compiles in a shared
              worker and renders, with the defaults an app wants. When the stream ends it compiles the finished document
              strictly. No bundler configuration: the worker, the wasm and the fonts are assets Vite and Next.js emit on
              their own.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link className="font-medium text-fd-primary hover:underline" href="/docs/getting-started/react">
                React quick start
              </Link>
              <Link className="font-medium text-fd-primary hover:underline" href="/docs/getting-started/nextjs-ai-sdk">
                Next.js and the AI SDK
              </Link>
              <Link className="font-medium text-fd-primary hover:underline" href="/docs/getting-started/vanilla">
                Without a framework
              </Link>
            </div>
          </div>
          <CodeCard
            file="app/answer.tsx"
            lines={[
              [k("import"), " { Typstream } ", k("from"), s(' "typstream"'), ";"],
              [k("import"), " { edu } ", k("from"), s(' "@typstream/edu"'), ";"],
              [],
              [k("export function"), f(" Answer"), "({ text, streaming }) {"],
              ["  ", k("return"), " ("],
              ["    ", t("<Typstream")],
              ["      ", a("source"), "={text}"],
              ["      ", a("isStreaming"), "={streaming}"],
              ["      ", a("target"), "=", s('"paged"')],
              ["      ", a("plugins"), "={[edu]}"],
              ["      ", a("animated caret")],
              ["    ", t("/>")],
              ["  );"],
              ["}"],
            ]}
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-24 text-center">
        <Sparkles className="mx-auto size-6 text-fd-primary" aria-hidden />
        <h2 className="font-display mx-auto mt-4 max-w-2xl text-4xl tracking-tight text-balance">
          Start rendering documents as they're written.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/getting-started/installation"
            className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
          >
            Get started <ArrowRight className="size-4" />
          </Link>
          <a
            href={githubUrl}
            className="inline-flex items-center gap-2 rounded-full border bg-fd-card px-5 py-2.5 text-sm font-medium hover:bg-fd-accent"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-fd-muted-foreground">
          <span className="font-display text-base text-fd-foreground">typstream</span>
          <nav className="flex flex-wrap gap-5">
            <Link href="/docs" className="hover:text-fd-foreground">
              Docs
            </Link>
            <a href="/llms.txt" className="hover:text-fd-foreground">
              llms.txt
            </a>
            <a href="/llms-full.txt" className="hover:text-fd-foreground">
              llms-full.txt
            </a>
            <a href={githubUrl} className="hover:text-fd-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.18em] text-fd-primary">{children}</p>;
}

function Feature({
  icon: Icon,
  title,
  href,
  children,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="group bg-fd-card p-6 transition-colors hover:bg-fd-accent/40">
      <Icon className="size-5 text-fd-primary" aria-hidden />
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{children}</p>
    </Link>
  );
}

/** A cut stream on the left, what typstream compiles on the right (`heal()`'s real output for each). */
function HealDiagram() {
  const rows: [string, ReactNode][] = [
    ["#table(columns: 2, [a], [b", <span key="table">#table(columns: 2, [a], [b{added("])")}</span>],
    ["Hello *bold", <span key="bold">Hello *bold{added("*")}</span>],
    ["The area is $pi r^", <span key="math">The area is $pi r{added("$")}</span>],
    [
      "#let x = ",
      <span key="let" className="text-fd-muted-foreground italic">
        (dropped until it's complete)
      </span>,
    ],
    ["## Results ↵ Most", <span key="heading">{added("==")} Results ↵ Most</span>],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border bg-fd-background font-mono text-[12.5px]">
      <div className="grid grid-cols-2 border-b bg-fd-muted/60 px-4 py-2 text-[11px] font-sans uppercase tracking-wider text-fd-muted-foreground">
        <span>The model has written</span>
        <span>typstream compiles</span>
      </div>
      {rows.map(([input, output]) => (
        <div key={input} className="grid grid-cols-2 gap-4 border-b px-4 py-3 last:border-b-0">
          <span className="truncate">
            {input}
            <span className="stream-caret ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-teal" />
          </span>
          <span className="truncate">{output}</span>
        </div>
      ))}
    </div>
  );
}

const added = (text: string) => <mark className="rounded-sm bg-fd-primary/15 px-0.5 text-fd-primary">{text}</mark>;

// A hand-highlighted snippet: the page is static, so no highlighter ships for one code block.
type Token = string | { text: string; className: string };
const k = (text: string): Token => ({ text, className: "text-[oklch(0.72_0.14_320)]" });
const s = (text: string): Token => ({ text, className: "text-[oklch(0.78_0.12_150)]" });
const f = (text: string): Token => ({ text, className: "text-[oklch(0.8_0.11_200)]" });
const t = (text: string): Token => ({ text, className: "text-[oklch(0.75_0.13_25)]" });
const a = (text: string): Token => ({ text, className: "text-[oklch(0.83_0.1_85)]" });

function CodeCard({ file, lines }: { file: string; lines: Token[][] }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-[oklch(0.2_0.02_255)] text-[oklch(0.9_0.01_85)] shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-xs text-white/50">{file}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static lines.
          <div key={i}>
            {line.length === 0
              ? " "
              : line.map((token, j) =>
                  typeof token === "string" ? (
                    token
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static tokens.
                    <span key={j} className={token.className}>
                      {token.text}
                    </span>
                  ),
                )}
          </div>
        ))}
      </pre>
    </div>
  );
}
