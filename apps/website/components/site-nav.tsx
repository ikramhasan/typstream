"use client";
// The landing page's navigation: a translucent bar floating off the top edge, and on small screens a
// full-height menu whose links arrive one after another.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";
import { githubUrl } from "@/lib/shared";

const LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Guides", href: "/docs/guides/prompting" },
  { label: "Examples", href: `${githubUrl}/tree/main/examples` },
  { label: "GitHub", href: githubUrl },
];

export const GET_STARTED = "/docs/getting-started/installation";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        id="mobile-menu"
        inert={!open}
        className={cn(
          "fixed inset-0 -z-10 flex flex-col bg-lp-bg/95 px-6 pt-24 backdrop-blur-xl transition-opacity duration-500 ease-lp md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ul className="flex flex-col gap-2">
          {[...LINKS, { label: "Get started", href: GET_STARTED }].map((link, i) => (
            <li
              key={link.label}
              className={cn(
                "transition duration-500 ease-lp",
                open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
              )}
              style={{ transitionDelay: open ? `${Math.min(i * 60, 400)}ms` : "0ms" }}
            >
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className="lp-focus block rounded-lg py-2 text-3xl font-semibold tracking-tight text-lp-ink"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <nav
        aria-label="Main"
        className="flex w-full items-center justify-between gap-8 rounded-full border border-lp-line bg-lp-card/70 py-2 pr-2 pl-4 shadow-[0_8px_24px_rgb(20_20_18/0.06)] backdrop-blur-md md:w-auto"
      >
        <Link
          href="/"
          aria-current="page"
          className="lp-focus flex items-center gap-2 rounded-full text-base font-semibold tracking-tight text-lp-ink"
        >
          <Logo className="size-6" />
          typstream
        </Link>
        <ul className="hidden items-center gap-6 md:flex">
          {LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="lp-focus rounded-sm text-sm font-medium text-lp-muted transition-colors duration-300 ease-lp hover:text-lp-ink"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={GET_STARTED}
          className="lp-focus hidden rounded-full bg-lp-ink px-3 py-2 text-sm font-semibold text-lp-bg transition duration-300 ease-lp hover:opacity-85 active:scale-[0.98] md:inline-flex"
        >
          Get started
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
          className="lp-focus relative size-10 rounded-full text-lp-ink md:hidden"
        >
          {/* Two lines that turn into a cross. */}
          <span
            className={cn(
              "absolute top-1/2 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-current transition-transform duration-500 ease-lp",
              open ? "-translate-y-1/2 rotate-45" : "-translate-y-[4px]",
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-current transition-transform duration-500 ease-lp",
              open ? "-translate-y-1/2 -rotate-45" : "translate-y-[2px]",
            )}
          />
        </button>
      </nav>
    </header>
  );
}
