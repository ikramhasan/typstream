# @typstream/google-fonts

Any family of the [Google Fonts](https://fonts.google.com) library in typstream documents, by name (PLAN.md §6.4, "As built: font catalogues"):

```typst
#set text(font: "Lora")
#show heading: set text(font: "Playfair Display")
#text(font: "Caveat")[Show your working.]
```

```tsx
import { googleFonts } from "@typstream/google-fonts";

<Typstream source={text} plugins={[googleFonts]} />;
// The model learns it may use them:
buildSystemPrompt([edu, googleFonts]);
```

- **A font catalogue.** `catalogue.json` lists every family of github.com/google/fonts at one commit, with its TTF files (style, weight or a variable font's weight range, size), served by jsDelivr from that commit. When a document names a family the engine doesn't have, the engine fetches the index (once), downloads the family and compiles the document again. Files over 20 MB, which jsDelivr won't serve, are left out; families over 5 MB (`createGoogleFonts({ maxBytes })`) aren't loaded.
- **HTML target.** Typst's HTML export drops fonts, so the preamble (`googleFontsPreamble`) marks text in another font than the document's own with its family (`<span data-typstream-font="lora">`), outside equations and frames. `mountTypstream` shows the families the engine loaded as web fonts made from the same files.
- **Prompt rules.** Exact names, one or two families, and the families that stand in for Arial, Times New Roman, Calibri and others, which aren't in the library.
- **Network.** Readers' browsers download from `cdn.jsdelivr.net` (allow it in `connect-src`). To avoid that, mirror the files and pass a copy of the index whose `base` points at the mirror: `createGoogleFonts({ index })`.

`node scripts/catalogue.mjs [<commit>]` writes `catalogue.json` again: one GitHub API call for the repository's tree, then each family's `METADATA.pb`.

Docs: [Fonts and languages](../../apps/website/content/docs/guides/fonts-and-languages.mdx#any-google-fonts-family), [reference](../../apps/website/content/docs/reference/google-fonts.mdx).
