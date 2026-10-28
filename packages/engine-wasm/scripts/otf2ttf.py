"""CFF-outline OpenType → TrueType outlines (#118): build.sh runs it on the base fonts
typst-assets ships as CFF (Libertinus Serif, New Computer Modern Math).

Word embeds only fonts with TrueType outlines, and the canvas, the PDF and the DOCX must
use the same files, so the engine ships these conversions instead of the originals.
Cubic curves become quadratic ones (fontTools' cu2qu, at most 1 font unit of error);
hinting, which Typst doesn't use, is dropped. Advances, kerning, the MATH table and every
other table stay, so text lays out the same (the #118 spike: every word of 143 of the 144
edu and LLM corpus documents in the same place, one math block 0.008 pt lower, as Typst
places some math by glyph bounds).

The fonts keep their names: Libertinus's OFL reserves other names, and the GUST Font
License only requests renaming. Both licenses ask that a modified version say so, so each
font's description (name ID 10) states the conversion, and dist/fonts/NOTICE where the
originals come from. The output is reproducible (no timestamps), so build.sh pins it.

    python3 -I otf2ttf.py fonttools.whl in.otf out.ttf

fontTools comes as its pure-Python wheel, imported from the zip (build.sh downloads it at
a pinned version and checks it); `-I` keeps anything else off the path.
"""

import sys

if len(sys.argv) != 4:
    sys.exit("usage: otf2ttf.py fonttools.whl in.otf out.ttf")
sys.path.insert(0, sys.argv[1])

from fontTools.pens.cu2quPen import Cu2QuPen  # noqa: E402
from fontTools.pens.ttGlyphPen import TTGlyphPen  # noqa: E402
from fontTools.ttLib import TTFont, newTable  # noqa: E402

NOTICE = (
    "Converted by typstream from CFF to TrueType outlines (fontTools cu2qu, max error 1 unit); "
    "hinting removed, nothing else changed. The original is in Typst's typst-assets."
)


def convert(src: str, dst: str) -> None:
    font = TTFont(src, recalcTimestamp=False)
    order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for name in order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyphs[name] = pen.glyph()

    del font["CFF "]
    font["loca"] = newTable("loca")
    font["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = glyphs
    font["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    for field in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
                  "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, field, 0)
    maxp.maxZones = 1
    font["head"].indexToLocFormat = 0
    font["head"].glyphDataFormat = 0
    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order
    font.sfntVersion = "\x00\x01\x00\x00"

    names = font["name"]
    for record in [r for r in names.names if r.nameID == 10]:
        names.removeNames(nameID=10, platformID=record.platformID, platEncID=record.platEncID, langID=record.langID)
    names.setName(NOTICE, 10, 3, 1, 0x409)
    names.setName(NOTICE, 10, 1, 0, 0)

    font.save(dst)


if __name__ == "__main__":
    convert(sys.argv[2], sys.argv[3])
