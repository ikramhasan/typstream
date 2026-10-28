"use client";
// The landing page's tagline: muted words that light up one at a time, in reading order, as they
// cross a line two thirds of the way down the viewport. Server-rendered fully lit, so it reads the
// same without JavaScript or with reduced motion.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = [...el.querySelectorAll<HTMLElement>("[data-word]")];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const trigger = window.innerHeight * 0.66;
      // Words are in reading order, so the lit ones are a prefix.
      let count = 0;
      for (const word of words) {
        const rect = word.getBoundingClientRect();
        if (rect.top + rect.height / 2 > trigger) break;
        count++;
      }
      setLit(count);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  let index = 0;
  return (
    <p
      ref={ref}
      className="mx-auto max-w-170 text-center text-balance text-4xl leading-tight font-semibold tracking-tight text-lp-night-ink sm:text-5xl sm:leading-none"
    >
      {lines.map((line, l) => (
        <span key={line} className="sm:block sm:py-1">
          {line.split(" ").map((word, w) => {
            const i = index++;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static words, which may repeat.
              <span key={w}>
                {w > 0 && " "}
                <span
                  data-word
                  className={cn("transition-opacity duration-500 ease-lp", i < lit ? "opacity-100" : "opacity-30")}
                >
                  {word}
                </span>
              </span>
            );
          })}
          {l < lines.length - 1 && " "}
        </span>
      ))}
    </p>
  );
}
