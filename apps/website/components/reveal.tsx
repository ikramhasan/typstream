"use client";
// A landing page section that rises into place the first time it enters the viewport. It's only
// hidden once the page has hydrated and the section is still below the fold, so without JavaScript,
// or for what is already on screen, nothing waits on it.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight) return;
    setHidden(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setHidden(false);
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("lp-reveal", className)} data-hidden={hidden || undefined}>
      {children}
    </div>
  );
}
