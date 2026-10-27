---
"@typstream/engine": minor
---

A browser client for a remote engine (#85): `fromWebSocket(url, options)` from the new `@typstream/engine/websocket` entry point connects `createEngine` to `@typstream/node`'s protocol server (`handleWebSocket`) over a WebSocket, so `createEngine({ spawn: fromWebSocket("wss://…") })` renders previews and exports without the wasm engine. Beta. It is its own entry point, so apps that compile in a worker don't download it. Each connection is a session; the client's watchdog closes it and opens another. `url` may be a function, called for every connection. Opening a connection is retried (`retries`, `retryDelayMs`); a server that can't be reached, or closes the connection before answering `initialize`, fails the engine.

`SpawnEngine` is now an interface with an optional `defaults` (beta): the `watchdog` budgets and `spare` that suit the transport, for options `createEngine` isn't given. `fromWebSocket` sets budgets above the server's own (`WEBSOCKET_DEFAULTS`: 10 s streaming, 30 s final), so the server's timeout answers first, and no spare connection.

Dropped connections are their own event: `EngineEvents.lost` (beta), which a `SpawnEngine` calls when its connection closes, makes the engine emit `disconnect`, open a new connection and retry the compile or export that was running, without a watchdog strike. After three losses in a row with requests in flight, a loss counts as a crash.
