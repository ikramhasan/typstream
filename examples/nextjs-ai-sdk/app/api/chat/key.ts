// The visitor's Anthropic key. A deployment of the example has no key of its own (no ANTHROPIC_API_KEY),
// so the page asks for one, keeps it in memory only, and sends it with each request in KEY_HEADER; the
// route uses it for that request's model call and never stores or logs it. Shared by the page and the
// route, so neither imports the other's code.

/** The request header carrying the visitor's Anthropic key, when the server has none. */
export const KEY_HEADER = "x-anthropic-api-key";

/** What `GET /api/chat` answers: whether the server has a key, so the page knows to ask for one. */
export type ChatConfig = { serverKey: boolean };
