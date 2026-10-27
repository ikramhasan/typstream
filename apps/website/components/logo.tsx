/** typstream's mark: a t being typed, in Newsreader italic (outlined, so it needs no font) with the caret. app/icon.svg is
    the same drawing. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="30" height="30" rx="7" className="fill-fd-primary" />
      <path
        d="M9.09 13.44 9.35 12.23H17.55L17.31 13.44ZM12.53 19.96Q12.37 20.46 12.29 20.77Q12.21 21.08 12.18 21.27Q12.15 21.47 12.15 21.6Q12.15 21.85 12.26 21.96Q12.37 22.08 12.55 22.08Q12.83 22.08 13.26 21.8Q13.69 21.54 14.25 20.98Q14.81 20.43 15.47 19.59L16.04 20Q15.3 21.17 14.58 22.01Q13.87 22.84 13.19 23.38Q12.52 23.91 11.9 24.16Q11.28 24.41 10.7 24.41Q9.97 24.41 9.51 23.99Q9.05 23.57 9.05 22.51Q9.05 22.08 9.16 21.42Q9.28 20.77 9.55 19.9L12.71 9.41H15.77Z"
        className="fill-fd-primary-foreground"
      />
      <rect x="19.7" y="7.6" width="3.2" height="16.5" rx="1" className="fill-logo-caret stream-caret" />
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
