import type { ReactNode } from "react";

export const ms = (value: number) => `${value < 1 ? value.toFixed(3) : value.toFixed(1)} ms`;

/** A collapsible inspector section. */
export const Section = ({ title, count, children }: { title: string; count?: number; children: ReactNode }) => (
  <details className="section" open>
    <summary>
      {title}
      {count === undefined ? null : <span className="count">{count}</span>}
    </summary>
    {children}
  </details>
);
