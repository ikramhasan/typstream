import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  CheckIcon,
  FilesIcon,
  GithubLogoIcon,
  GraduationCapIcon,
  LightningIcon,
  LockKeyIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { heal } from "@typstream/heal";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCommand } from "@/components/copy-command";
import { DocumentSheet } from "@/components/document-sheet";
import { LiveDemo, type Recording } from "@/components/live-demo";
import { Logo } from "@/components/logo";
import { Reveal } from "@/components/reveal";
import { GET_STARTED } from "@/components/site-nav";
import { TaglineReveal } from "@/components/tagline-reveal";
import { cn } from "@/lib/cn";
import { healedSegments } from "@/lib/heal-segments";
import { githubUrl } from "@/lib/shared";

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

const finished = (recording: Recording) => recording.chunks.map((c) => c.text).join("");

const FAQ: { q: string; a: string }[] = [
  {
    q: "Which models does it work with?",
    a: "Any model that writes Typst. typstream reads text, not an SDK, so Claude, GPT and local models all work. The teaching prompt kit is measured on recorded Claude streams.",
  },
  {
    q: "Do I need to run a server?",
    a: "No. The engine runs in a web worker in your users' browser. The same engine runs in Node when you want to validate documents or render PDFs on the server.",
  },
  {
    q: "How much does it add to my bundle?",
    a: "The React component is about 20 KB gzipped. Typst itself is a WebAssembly file under 6.3 MB compressed, loaded in a worker and cached after the first visit.",
  },
  {
    q: "What if the finished document has an error?",
    a: "When the stream ends the document is compiled strictly. Diagnostics come back with source positions, so you can show them or send them to the model to fix.",
  },
  {
    q: "Can documents use Typst packages?",
    a: "Yes, from an allowlist: CeTZ, fletcher, cetz-plot, physica, unify, chemformula and alchemist. They're vendored with integrity hashes, so nothing is fetched at render time.",
  },
  {
    q: "Is it safe to render what a model writes?",
    a: "Documents get no network and no files you didn't pass. Output goes through a sanitizer, a watchdog stops runaway loops, and it all runs under a strict Content Security Policy.",
  },
  {
    q: "Does it work without React?",
    a: "Yes. mountTypstream from @typstream/dom renders into any element, with or without a framework. The React component is a thin layer over it.",
  },
  {
    q: "Can the model edit a document it already wrote?",
    a: "Yes. @typstream/ai streams edits that quote the text they replace and applies them in place as they arrive, with a highlight and undo.",
  },
];

export default function HomePage() {
  const recordings = loadRecordings();
  const [, chemistry, arabic, bengali] = recordings as [Recording, Recording, Recording, Recording];
  return (
    <>
      <main id="main" className="flex-1 overflow-x-clip">
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from the FAQ above.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQ.map(({ q, a }) => ({
                "@type": "Question",
                name: q,
                acceptedAnswer: { "@type": "Answer", text: a },
              })),
            }),
          }}
        />

        <section className="mx-auto max-w-7xl px-6 pt-36 pb-16 sm:px-10">
          <div className="flex flex-col items-center gap-6 text-center">
            <Link
              href="/docs/concepts/how-it-works"
              className="lp-focus inline-flex items-center gap-2 rounded-full border border-lp-line bg-lp-card px-3 py-1 text-xs font-medium text-lp-muted transition-colors duration-300 ease-lp hover:text-lp-ink"
            >
              <span className="size-1.5 rounded-full bg-lp-accent" aria-hidden />
              Typst 0.15.1, compiled to WebAssembly
            </Link>
            <h1 className="max-w-170 text-4xl leading-none font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              <span className="lp-heading-gradient inline-block pb-1">
                Render Typst while
                <br />
                the model writes it
              </span>
              <span
                className="stream-caret ml-2 inline-block h-[0.8em] w-1.5 rounded-xs bg-lp-caret align-[-0.08em]"
                aria-hidden
              />
            </h1>
            <p className="max-w-170 text-lg text-pretty text-lp-muted">
              typstream heals every streamed prefix with a port of Typst's own parser, compiles it in a worker and
              redraws only what changed. Your users watch a typeset worksheet arrive, not a spinner.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <PrimaryCta />
              <CopyCommand command="npm install typstream" />
            </div>
            <p className="inline-flex items-center gap-2 text-sm text-lp-muted">
              <CheckCircleIcon className="size-4 shrink-0 text-lp-accent" aria-hidden />
              Ported from Typst 0.15.1's parser and checked against it on 20,000 random streams.
            </p>
          </div>
          <div className="mt-16">
            <LiveDemo recordings={recordings} />
          </div>
        </section>

        <section aria-label="typstream in numbers" className="mx-auto max-w-7xl px-6 pb-24 sm:px-10">
          <Reveal>
            <dl className="grid border-y border-lp-strong-line sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-lp-line">
              <Stat value="99.93%" label="of prefixes compile">
                A faithful port of Typst's own parser closes what the model left open.
              </Stat>
              <Stat value="~5 ms" label="incremental compile">
                Typst 0.15.1 as WebAssembly, in a worker, redrawing only what changed.
              </Stat>
              <Stat value="15.3 KB" label="healer, gzipped">
                Small enough to heal every token well inside the main thread's budget.
              </Stat>
              <Stat value="0" label="blank frames">
                A fallback ladder keeps the last good render, or isolates the one block that fails.
              </Stat>
            </dl>
          </Reveal>
        </section>

        <section className="bg-lp-tint">
          <Reveal className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-24 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,40rem)]">
            <div className="flex flex-col gap-6">
              <Eyebrow>The problem</Eyebrow>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                One unclosed bracket <br className="hidden sm:inline" />
                and Typst won't compile
              </h2>
              <p className="text-pretty text-lp-muted">
                Markdown degrades gracefully. Typst is a compiled language, which is why worksheets look so much better
                in it, and why half of one fails outright. So most apps show raw text or a spinner until the model is
                done.
              </p>
              <p className="text-pretty text-lp-muted">
                typstream closes what's open, holds back what can't be closed yet, and hands Typst a prefix that
                compiles. It's a port of Typst's own parser, tested against the real one on every prefix.
              </p>
              <TextLink href="/docs/concepts/healing">How healing works</TextLink>
            </div>
            <HealTable />
          </Reveal>
        </section>

        <section className="bg-lp-night px-6 py-24 sm:px-10">
          <TaglineReveal
            lines={["From the first token", "to the last, your users", "read a real document,", "never a blank page."]}
          />
        </section>

        <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
          <Reveal className="grid gap-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-24">
            <div className="flex flex-col gap-6 self-start lg:sticky lg:top-32">
              <Eyebrow>What you get</Eyebrow>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything between <br className="hidden sm:inline" />
                the model and the page
              </h2>
              <p className="text-pretty text-lp-muted">
                Healing, scheduling, compiling and rendering, with the defaults an app wants. You pass the text so far.
              </p>
            </div>
            <ul className="divide-y divide-lp-line border-y border-lp-line">
              <Benefit
                icon={ShieldCheckIcon}
                title="Never a blank screen"
                value="5"
                unit="repair layers"
                href="/docs/concepts/fallback"
              >
                Fixers repair what parses but doesn't compile yet. If a block still fails, only that block is isolated
                and the last good render stays up.
              </Benefit>
              <Benefit
                icon={LightningIcon}
                title="Smooth on the main thread"
                value="0.2 ms"
                unit="per token, p95"
                href="/docs/concepts/streaming"
              >
                Healing takes 0.2 ms per token at p95, even at 50 KB. Compiling runs in a worker, so the page keeps
                scrolling while a document streams in.
              </Benefit>
              <Benefit
                icon={FilesIcon}
                title="Print faithful or reflowing"
                value="2"
                unit="render targets"
                href="/docs/concepts/render-targets"
              >
                Pages with a selectable text layer, or semantic HTML and MathML that reflow and follow your theme. Only
                what changed is redrawn.
              </Benefit>
              <Benefit
                icon={LockKeyIcon}
                title="Safe with untrusted output"
                value="3"
                unit="browsers checked"
                href="/docs/guides/security"
              >
                No network, no files you didn't pass, a sanitized DOM and a watchdog for runaway loops, all under a
                strict Content Security Policy.
              </Benefit>
              <Benefit
                icon={GraduationCapIcon}
                title="Made for teachers' documents"
                value="7"
                unit="Typst packages built in"
                href="/docs/guides/edu-documents"
              >
                Questions, multiple choice, rubrics, and answer keys only the teacher's copy shows. CeTZ diagrams,
                Arabic and Bengali work out of the box.
              </Benefit>
            </ul>
          </Reveal>
        </section>

        <section className="bg-lp-night text-lp-night-ink">
          <Reveal className="mx-auto flex max-w-7xl flex-col gap-16 px-6 py-24 sm:px-10">
            <div className="flex max-w-170 flex-col gap-6">
              <Eyebrow night>How it works</Eyebrow>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                One component. <br className="hidden sm:inline" />
                Three steps on every token.
              </h2>
            </div>
            <div className="grid items-start gap-16 lg:grid-cols-2">
              <ol className="flex flex-col gap-10">
                <Step n="01" title="Heal">
                  The text so far is repaired with a port of Typst's parser. Settled text is never touched, so each new
                  token only costs the tail.
                </Step>
                <Step n="02" title="Compile">
                  A shared worker compiles it with Typst 0.15.1 in WebAssembly, paced so a fast model never floods it.
                  The finished document compiles strictly.
                </Step>
                <Step n="03" title="Render">
                  Only changed pages are redrawn, new words fade in, and a caret marks where the model is writing. If
                  one block breaks, only that block falls back.
                </Step>
              </ol>
              <CodeCard />
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
          <Reveal className="flex flex-col gap-16">
            <div className="flex flex-col gap-12 lg:flex-row lg:items-end lg:justify-between lg:gap-24">
              <div className="flex max-w-xl flex-col gap-6">
                <Eyebrow>Proof</Eyebrow>
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Tested against real Typst, <br className="hidden sm:inline" />
                  not against guesses about it
                </h2>
                <p className="text-pretty text-lp-muted">
                  Healing is checked against Typst's own parser, and the engine against the native typst command line.
                  Below are three of the Claude streams it records and replays, rendered here by the same engine.
                </p>
              </div>
              <dl className="grid shrink-0 gap-6 sm:grid-cols-3 sm:gap-8">
                {[
                  ["141", "recorded model streams"],
                  ["20,000", "random streams a run"],
                  ["3", "browser engines per PR"],
                ].map(([value, label], i) => (
                  <div
                    key={label}
                    className={cn("flex flex-col gap-1", i > 0 && "sm:border-l sm:border-lp-line sm:pl-8")}
                  >
                    <dt className="order-2 text-sm text-lp-muted">{label}</dt>
                    <dd className="text-4xl font-semibold tracking-tight">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <Sheet
                source={finished(arabic)}
                title="Solar system quiz in Arabic"
                meta="Grade 4 science, set right to left"
              />
              <Sheet
                source={finished(bengali)}
                title="Multiplication quiz in Bengali"
                meta="Grade 3 maths, with blanks to fill"
              />
              <Sheet
                source={finished(chemistry)}
                title="Balancing chemical equations"
                meta="Grade 9 chemistry worksheet"
              />
            </div>
          </Reveal>
        </section>

        <section className="bg-lp-tint">
          <Reveal className="mx-auto grid max-w-7xl gap-16 px-6 py-24 sm:px-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-24">
            <div className="flex flex-col gap-6 self-start">
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Questions before <br className="hidden sm:inline" />
                you install
              </h2>
              <p className="text-pretty text-lp-muted">
                Something missing? Open an issue on GitHub and we'll answer it there.
              </p>
              <TextLink href={`${githubUrl}/issues`} icon={GithubLogoIcon}>
                Ask on GitHub
              </TextLink>
            </div>
            <div className="divide-y divide-lp-strong-line/60 border-b border-lp-strong-line/60">
              {FAQ.map(({ q, a }, i) => (
                <details key={q} open={i === 0} className="group">
                  <summary className="lp-focus flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-6 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {q}
                    {/* A plus whose vertical bar folds away into a minus. */}
                    <span className="relative size-5 shrink-0 text-lp-muted group-open:text-lp-accent" aria-hidden>
                      <span className="absolute top-1/2 left-0 h-0.5 w-5 -translate-y-1/2 rounded-full bg-current" />
                      <span className="absolute top-0 left-1/2 h-5 w-0.5 -translate-x-1/2 rounded-full bg-current transition-transform duration-300 ease-lp group-open:scale-y-0" />
                    </span>
                  </summary>
                  <p className="max-w-150 pb-6 text-pretty text-lp-muted">{a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="bg-lp-night text-lp-night-ink">
          <Reveal className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-6 py-24 text-center sm:px-10">
            <h2 className="text-balance max-w-170 text-4xl leading-none font-semibold tracking-tight sm:text-5xl">
              <span className="lp-heading-gradient lp-on-night inline-block pb-1">
                Show the document <br className="hidden sm:inline" />
                while it's being written
              </span>
            </h2>
            <p className="max-w-170 text-lg text-pretty text-lp-night-muted">
              Install one package, pass it the text so far,
              <br className="hidden sm:block" /> and your users watch a typeset page arrive.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <PrimaryCta />
              <CopyCommand command="npm install typstream" tone="night" />
            </div>
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-lp-night-muted">
              {["No server to run", "No account or API key", "Runs in your users' browser"].map((point) => (
                <li key={point} className="inline-flex items-center gap-2">
                  <CheckIcon className="size-4 text-lp-night-accent" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      </main>
      <Footer />
    </>
  );
}

function PrimaryCta() {
  return (
    <Link
      href={GET_STARTED}
      className="lp-focus group inline-flex items-center gap-2 rounded-lg bg-lp-accent px-4 py-3 text-base font-semibold text-lp-accent-fg shadow-[0_1px_2px_rgb(0_114_125/0.25)] transition duration-300 ease-lp hover:opacity-90 active:scale-[0.98]"
    >
      Add typstream to your app
      <ArrowRightIcon className="size-4 transition-transform duration-300 ease-lp group-hover:translate-x-0.5" />
    </Link>
  );
}

function Eyebrow({ children, night = false }: { children: ReactNode; night?: boolean }) {
  return (
    <p
      className={cn(
        "text-xs font-semibold tracking-[0.15em] uppercase",
        night ? "text-lp-night-accent" : "text-lp-accent",
      )}
    >
      {children}
    </p>
  );
}

function TextLink({ href, icon: Icon = ArrowRightIcon, children }: { href: string; icon?: Icon; children: ReactNode }) {
  const trailing = Icon === ArrowRightIcon;
  return (
    <Link
      href={href}
      className="lp-focus group inline-flex items-center gap-2 self-start rounded-sm text-sm font-semibold text-lp-accent"
    >
      {!trailing && <Icon className="size-4" aria-hidden />}
      {children}
      {trailing && (
        <Icon className="size-4 transition-transform duration-300 ease-lp group-hover:translate-x-0.5" aria-hidden />
      )}
    </Link>
  );
}

function Stat({ value, label, children }: { value: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-8 sm:pr-6 lg:px-6 lg:first:pl-0 lg:last:pr-0">
      <dt className="order-2 flex flex-col gap-1">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-sm text-pretty text-lp-muted">{children}</span>
      </dt>
      <dd className="text-5xl leading-none font-semibold tracking-tight">{value}</dd>
    </div>
  );
}

/** Each row is `heal()`'s real output for a cut stream, computed when the page is built. */
function HealTable() {
  const rows = ["#table(columns: 2, [a], [b", "Hello *bold", "The area is $pi r^", "#let x = ", "## Results\nMost"];
  const show = (text: string) => text.replace(/\n/g, " ↵ ");
  return (
    <div className="overflow-hidden rounded-2xl border border-lp-line bg-lp-card font-lp-mono text-sm">
      <div className="grid grid-cols-2 gap-6 bg-lp-tint/50 px-6 py-3 font-lp text-xs font-medium text-lp-muted">
        <span>The model has written</span>
        <span>typstream compiles</span>
      </div>
      {rows.map((input) => {
        const result = heal(input);
        const { segments } = healedSegments(input, result.source, result.patches);
        return (
          <div key={input} className="grid grid-cols-2 gap-6 border-t border-lp-line px-6 py-4">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {show(input)}
              <span className="stream-caret ml-px inline-block h-4 w-0.5 translate-y-0.5 bg-lp-caret" />
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {result.source === "" ? (
                <span className="font-lp text-lp-muted">held back until it's complete</span>
              ) : (
                segments.map((s, i) =>
                  s.added ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                    <mark key={i} className="rounded bg-lp-accent/15 px-0.5 font-semibold text-lp-accent">
                      {s.text}
                    </mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                    <span key={i}>{show(s.text)}</span>
                  ),
                )
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Benefit({
  icon: Icon,
  title,
  value,
  unit,
  href,
  children,
}: {
  icon: Icon;
  title: string;
  value: string;
  unit: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-6 py-8 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className="flex size-10 items-center justify-center rounded-lg bg-lp-accent/10 text-lp-accent">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight">
          <Link href={href} className="lp-focus rounded-sm transition-colors duration-300 ease-lp hover:text-lp-accent">
            {title}
          </Link>
        </h3>
        <p className="text-pretty text-lp-muted">{children}</p>
      </div>
      <div className="col-start-2 flex flex-col gap-1 sm:col-start-auto sm:w-40 sm:items-end sm:text-right">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        <span className="text-xs text-lp-muted">{unit}</span>
      </div>
    </li>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-6">
      <span className="pt-1 font-lp-mono text-sm text-lp-night-accent">{n}</span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="text-pretty text-lp-night-muted">{children}</p>
      </div>
    </li>
  );
}

function Sheet({ source, title, meta }: { source: string; title: string; meta: string }) {
  return (
    <figure className="flex flex-col gap-4">
      <DocumentSheet source={source} />
      <figcaption className="flex flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-lp-muted">{meta}</span>
      </figcaption>
    </figure>
  );
}

// A hand-highlighted snippet: the page is static, so no highlighter ships for one code block.
type Token = string | [string, string];
const CODE: Token[][] = [
  [["import", "lp-tok-fn"], " { Typstream } ", ["from", "lp-tok-fn"], [' "typstream"', "lp-tok-str"], ";"],
  [["import", "lp-tok-fn"], " { edu } ", ["from", "lp-tok-fn"], [' "@typstream/edu"', "lp-tok-str"], ";"],
  [],
  [["export function", "lp-tok-fn"], [" Answer", "lp-tok-name"], "({ text, streaming }) {"],
  [["  return", "lp-tok-fn"], " ("],
  [["    <Typstream", "lp-tok-tag"]],
  [["      source", "lp-tok-key"], "={text}"],
  [["      isStreaming", "lp-tok-key"], "={streaming}"],
  [["      target", "lp-tok-key"], "=", ['"paged"', "lp-tok-str"]],
  [["      plugins", "lp-tok-key"], "={[edu]}"],
  [["    />", "lp-tok-tag"]],
  ["  );"],
  ["}"],
];

function CodeCard() {
  const guides = [
    ["React quick start", "/docs/getting-started/react"],
    ["Next.js and the AI SDK", "/docs/getting-started/nextjs-ai-sdk"],
    ["Without a framework", "/docs/getting-started/vanilla"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-lp-night-line bg-lp-night-2">
      <div className="bg-lp-night-3 px-5 py-3 font-lp-mono text-xs text-lp-night-muted">app/answer.tsx</div>
      <pre className="overflow-x-auto px-6 py-5 font-lp-mono text-sm leading-6 text-[#e8e6df]">
        {CODE.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static lines.
          <div key={i}>
            {line.length === 0
              ? " "
              : line.map((token, j) =>
                  typeof token === "string" ? (
                    token
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static tokens.
                    <span key={j} className={token[1]}>
                      {token[0]}
                    </span>
                  ),
                )}
          </div>
        ))}
      </pre>
      <div className="flex flex-wrap gap-x-6 gap-y-2 bg-[#181818] px-6 py-4">
        {guides.map(([label, href]) => (
          <Link
            key={href}
            href={href as string}
            className="lp-focus group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-lp-night-ink"
          >
            {label}
            <ArrowUpRightIcon
              className="size-3.5 text-lp-night-muted transition-transform duration-300 ease-lp group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  const columns: [string, [string, string][]][] = [
    [
      "Docs",
      [
        ["Quick start", GET_STARTED],
        ["Concepts", "/docs/concepts/how-it-works"],
        ["Reference", "/docs/reference/typstream"],
      ],
    ],
    [
      "For agents",
      [
        ["llms.txt", "/llms.txt"],
        ["llms-full.txt", "/llms-full.txt"],
        ["Markdown docs", "/docs.md"],
      ],
    ],
    [
      "Project",
      [
        ["GitHub", githubUrl],
        ["Issues", `${githubUrl}/issues`],
        ["Roadmap", `${githubUrl}/issues/38`],
      ],
    ],
  ];
  return (
    <footer className="bg-lp-night text-lp-night-ink">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <div className="flex flex-col gap-16 border-t border-lp-night-line pt-16 pb-10">
          <div className="flex flex-col justify-between gap-12 md:flex-row">
            <div className="flex flex-col gap-3">
              <span className="inline-flex items-center gap-2 font-semibold">
                <Logo className="size-6" />
                typstream
              </span>
              <span className="text-sm text-lp-night-muted">Render Typst streamed from a model, live.</span>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-12 sm:grid-cols-3 sm:gap-24">
              {columns.map(([heading, links]) => (
                <div key={heading} className="flex flex-col gap-3">
                  <h2 className="text-balance text-sm font-semibold">{heading}</h2>
                  {links.map(([label, href]) => (
                    <Link
                      key={label}
                      href={href}
                      className="lp-focus self-start rounded-sm text-sm text-lp-night-muted transition-colors duration-300 ease-lp hover:text-lp-night-ink"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
          <p className="text-xs text-[#6e6b63]">© {new Date().getFullYear()} typstream</p>
        </div>
      </div>
    </footer>
  );
}
