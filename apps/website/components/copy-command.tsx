"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** A shell command that copies itself; `night` for the landing page's dark bands. */
export function CopyCommand({ command, tone = "paper" }: { command: string; tone?: "paper" | "night" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cn(
        "lp-focus group inline-flex items-center gap-3 rounded-lg border px-4 py-3 font-lp-mono text-sm transition duration-300 ease-lp active:scale-[0.98]",
        tone === "paper"
          ? "border-lp-line bg-lp-card text-lp-ink hover:border-lp-strong-line"
          : "border-lp-night-line bg-lp-night-2 text-lp-night-ink hover:border-lp-night-muted",
      )}
      aria-label={copied ? `Copied "${command}"` : `Copy "${command}"`}
    >
      <span className={tone === "paper" ? "text-lp-muted" : "text-lp-night-muted"}>$</span>
      {command}
      {copied ? (
        <CheckIcon className={cn("size-4", tone === "paper" ? "text-lp-accent" : "text-lp-night-accent")} />
      ) : (
        <CopyIcon className={cn("size-4", tone === "paper" ? "text-lp-muted" : "text-lp-night-muted")} />
      )}
    </button>
  );
}
