"use client";
// The top of a finished recording's first page, compiled by the real engine as the landing page's
// proof: what typstream rendered from a model's answer, not a picture of it. It compiles only once
// it nears the viewport (<Typstream> is lazy by default).

import { edu } from "@typstream/edu";
import { Typstream } from "typstream";

const PLUGINS = [edu];

export function DocumentSheet({ source }: { source: string }) {
  return (
    <div className="h-75 overflow-hidden rounded-2xl bg-lp-desk px-8 pt-8" inert>
      <div className="demo-sheets pointer-events-none select-none">
        <Typstream source={source} target="paged" layout="fit-width" plugins={PLUGINS} />
      </div>
    </div>
  );
}
