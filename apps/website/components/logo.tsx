/** typstream's mark: a page with lines still being written. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="4" y="2.5" width="24" height="27" rx="4" className="fill-fd-primary" />
      <path
        d="M10 10h12M10 15h12M10 20h7"
        className="stroke-fd-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect x="19.5" y="18.4" width="2.4" height="3.2" rx="0.6" className="fill-fd-primary-foreground stream-caret" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Logo className="size-6" />
      <span className="font-display text-[1.15rem] tracking-tight">typstream</span>
    </span>
  );
}
