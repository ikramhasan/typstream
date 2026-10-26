// Reads the `.tar.gz` packages Typst Universe publishes (PLAN §6.4): gunzip with
// the platform's DecompressionStream (browsers and Node ≥ 18), then a ustar
// reader for regular files. Universe tarballs are plain ustar; long names
// (the ustar prefix field, pax `path` and GNU `L` records) are read anyway so
// a mirror's repacked archive works too.

const BLOCK = 512;
const utf8 = new TextDecoder();

/** Decompresses gzip. */
export const gunzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** A NUL-terminated header field. */
const field = (block: Uint8Array, from: number, length: number): string => {
  const bytes = block.subarray(from, from + length);
  const end = bytes.indexOf(0);
  return utf8.decode(end < 0 ? bytes : bytes.subarray(0, end));
};

/** The `path` record of a pax extended header (`<length> path=<value>\n`, lengths in bytes). */
const paxPath = (data: Uint8Array): string | undefined => {
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at);
    const length = space < 0 ? Number.NaN : Number.parseInt(utf8.decode(data.subarray(at, space)), 10);
    if (!(length > 0)) break;
    const record = utf8.decode(data.subarray(space + 1, at + length - 1));
    if (record.startsWith("path=")) return record.slice(5);
    at += length;
  }
  return undefined;
};

/**
 * The regular files of a tar archive, by path without a leading `./`.
 * Directories, links and other entries are skipped. Throws on a truncated
 * or malformed archive.
 */
export const untar = (tar: Uint8Array): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>();
  let longName: string | undefined;
  for (let at = 0; at + BLOCK <= tar.length; ) {
    const header = tar.subarray(at, at + BLOCK);
    // Two zero blocks end the archive; one is enough to stop.
    if (header[0] === 0) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("malformed tar header");
    const start = at + BLOCK;
    if (start + size > tar.length) throw new Error("truncated tar archive");
    const data = tar.subarray(start, start + size);
    const type = field(header, 156, 1);
    if (type === "x") longName = paxPath(data) ?? longName;
    else if (type === "L") longName = utf8.decode(data).replace(/\0+$/, "");
    else {
      if (type === "0" || type === "") {
        const prefix = field(header, 345, 155);
        const name = longName ?? (prefix ? `${prefix}/` : "") + field(header, 0, 100);
        files.set(name.replace(/^(\.\/)+/, ""), data);
      }
      longName = undefined;
    }
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
};
