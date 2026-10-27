// The example's analytics sink: the client batches typstream's events here
// (app/telemetry.tsx). A real app would forward them to its analytics or a
// table to aggregate weekly (PLAN §12); this prints one line per event.

interface Event {
  type: "rendered" | "fallback" | "watchdog";
  uri: string;
  rev: number;
  mode: "streaming" | "final";
  [field: string]: unknown;
}

const describe = (e: Event): string => {
  switch (e.type) {
    case "rendered":
      return `compile ${e.compileMs} ms, heal ${e.healMs} ms, render ${e.renderMs} ms, fallback ${e.fallbackLevel}`;
    case "fallback":
      return `level ${e.level}, ${e.consecutive} in a row, ${e.inputLength} characters`;
    case "watchdog":
      return `${e.reason} after ${e.budgetMs} ms, strike ${e.strikes}`;
  }
};

export async function POST(req: Request) {
  const events = (await req.json()) as Event[];
  for (const e of events) console.log(`[telemetry] ${e.type} ${e.uri} rev ${e.rev} (${e.mode}): ${describe(e)}`);
  return new Response(null, { status: 204 });
}
