"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
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
      className="group inline-flex items-center gap-3 rounded-full border bg-fd-card px-4 py-2.5 font-mono text-sm transition-colors hover:bg-fd-accent"
      aria-label={`Copy "${command}"`}
    >
      <span className="text-fd-muted-foreground">$</span>
      {command}
      {copied ? (
        <Check className="size-4 text-fd-primary" />
      ) : (
        <Copy className="size-4 text-fd-muted-foreground group-hover:text-fd-foreground" />
      )}
    </button>
  );
}
