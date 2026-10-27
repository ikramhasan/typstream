// The model's image search: Wikimedia Commons, whose images are freely licensed and served with
// CORS, so the page can fetch them itself (`fetchImages` in app/page.tsx allows their hosts). A
// model can't know a real image URL on its own; it uses only the ones this returns. Commons needs
// no key, but wants a User-Agent that names the client (its rate limit is 200 requests a minute).

import { type InferUITools, isStepCount, tool } from "ai";
import { z } from "zod";

const USER_AGENT = "typstream-example/0.1 (https://github.com/ikramhasan/typstream) bot";

/** Width of the image the URL points at, px: sharp in print at half the page, a few hundred KB. */
const WIDTH = 960;
const RESULTS = 6;

/** An image the document may use, with what the model needs to choose it and credit it. */
export type FoundImage = {
  url: string;
  title: string;
  description: string;
  width: number;
  height: number;
  author: string;
  license: string;
};

export type ImageSearchResult = { images: FoundImage[] } | { error: string };

type CommonsPage = {
  index: number;
  title: string;
  imageinfo?: {
    url: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width: number;
    height: number;
    extmetadata?: Record<string, { value?: string }>;
  }[];
};

/** Commons' metadata is HTML (links, spans); the model needs the words. */
const plain = (html: string | undefined, max = 200) =>
  (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export async function searchCommons(query: string, signal?: AbortSignal): Promise<ImageSearchResult> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    // Images and drawings only: no PDFs, videos or audio.
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: String(RESULTS),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: String(WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription",
  });
  let res: Response;
  try {
    res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
  } catch (e) {
    return { error: `Wikimedia Commons didn't answer (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!res.ok) return { error: `Wikimedia Commons answered ${res.status}` };
  const data = (await res.json()) as { query?: { pages?: CommonsPage[] } };
  const pages = [...(data.query?.pages ?? [])].sort((a, b) => a.index - b.index);
  const images = pages.flatMap((page): FoundImage[] => {
    const info = page.imageinfo?.[0];
    if (!info) return [];
    const meta = info.extmetadata ?? {};
    // The resized image (SVGs come back as PNG) on thumb.wikimedia.org, or the original on
    // upload.wikimedia.org when it's smaller than WIDTH. Its tracking query is dropped: typstream
    // turns a URL into a file path, and the image doesn't need it.
    const url = (info.thumburl ?? info.url).split("?")[0] as string;
    return [
      {
        url,
        title: page.title.replace(/^File:/, ""),
        description: plain(meta.ImageDescription?.value),
        width: info.thumbwidth ?? info.width,
        height: info.thumbheight ?? info.height,
        author: plain(meta.Artist?.value, 100) || "unknown",
        license: plain(meta.LicenseShortName?.value, 50) || "see Wikimedia Commons",
      },
    ];
  });
  return { images };
}

export const tools = {
  searchImages: tool({
    description:
      "Search Wikimedia Commons for freely licensed images: photos, diagrams, maps, illustrations. Returns image URLs to use in image(...), with each image's size, description, author and license.",
    inputSchema: z.object({
      query: z.string().describe('A short English search, e.g. "plant cell diagram" or "Eiffel Tower"'),
    }),
    execute: ({ query }, { abortSignal }) => searchCommons(query, abortSignal),
  }),
};

/** The tools as the page sees them in a message's parts (`tool-searchImages`). */
export type ChatTools = InferUITools<typeof tools>;

/** Searches, then the document: a few rounds of tool calls before the answer. */
export const stopWhen = isStepCount(5);

/** Added to edu's prompt: when to search, and how to place and credit what it finds. */
export const IMAGE_RULES = `## Images

You can put real images in a document with the searchImages tool (Wikimedia Commons). Use it when the request asks for pictures, photos or images, or when a real photograph, map or detailed illustration helps. A diagram you can draw well with CeTZ or edu's drawings is better drawn.

- Search before you write anything. Your reply is the document, so call searchImages first (short English queries, at most 3 searches), then write the whole document in one go, with no text before it.
- Use only URLs that searchImages returned, exactly as given. Never write any other image URL.
- Put each image in a figure and credit it in the caption, with its author and license: #figure(image("https://…", width: 60%), caption: [A plant cell. Image: LadyofHats, public domain, via Wikimedia Commons]).
- Prefer images whose labels are in the document's language, or that have no labels.
- If nothing fits, leave the image out.`;
