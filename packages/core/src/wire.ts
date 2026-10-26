// Protocol messages as text, for transports that can't structured-clone
// (a WebSocket to `@typstream/node`'s server, PLAN §6.1). Messages are plain
// data except for bytes (`FileContent`, PDF exports), so this is JSON with every
// `Uint8Array` written as `{ "$bytes": "<base64>" }`.

const BYTES = "$bytes";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE = new Map([...ALPHABET].map((c, i) => [c, i]));

// Hand-written so core stays dependency- and environment-free (no Buffer, no
// btoa, which only takes Latin-1 strings anyway).
const toBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : ALPHABET[c & 63];
  }
  return out;
};

const fromBase64 = (text: string): Uint8Array => {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    const v = DECODE.get(ch);
    if (v === undefined) throw new SyntaxError(`invalid base64 character ${JSON.stringify(ch)}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
};

/**
 * Writes a protocol message (or any plain data holding `Uint8Array`s) as JSON
 * text. Read it back with {@link deserializeMessage}.
 * @public
 */
export const serializeMessage = (message: unknown): string =>
  JSON.stringify(message, function (this: Record<string, unknown>, key, value: unknown) {
    // `this[key]` is the value before `toJSON`: Node's Buffer (a Uint8Array) has one.
    const raw = this[key];
    return raw instanceof Uint8Array ? { [BYTES]: toBase64(raw) } : value;
  });

/**
 * Parses text written by {@link serializeMessage}, restoring `Uint8Array`s.
 * Validate the result before trusting it: this only parses.
 * @public
 */
export const deserializeMessage = (text: string): unknown =>
  JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const bytes = (value as Record<string, unknown>)[BYTES];
      if (keys.length === 1 && typeof bytes === "string") return fromBase64(bytes);
    }
    return value;
  });
