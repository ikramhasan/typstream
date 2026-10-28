"""CFF-outline OpenType → TrueType outlines, as Word embeds only those (#118).

Cubic curves become quadratic ones (fontTools' cu2qu, max error 1 unit at
1000 upm); hinting is dropped. Advances, kerning and every other table stay,
so text lays out the same. After fontTools' Snippets/otf2ttf.py.

    python otf2ttf.py in.otf out.ttf
"""

import sys

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable


def convert(src, dst, max_err=1.0):
    font = TTFont(src)
    glyph_order = font.getGlyphOrder()
    glyf = {}
    glyph_set = font.getGlyphSet()
    for name in glyph_order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, max_err, reverse_direction=True))
        glyf[name] = pen.glyph()
    font["loca"] = newTable("loca")
    font["glyf"] = g = newTable("glyf")
    g.glyphOrder = glyph_order
    g.glyphs = glyf
    del font["CFF "]
    if "VORG" in font:
        del font["VORG"]
    font["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    for attr in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
                 "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, attr, 0)
    maxp.maxZones = 1
    font["head"].indexToLocFormat = 0
    font["head"].glyphDataFormat = 0
    font["post"].formatType = 2.0
    font["post"].extraNames = []
    font["post"].mapping = {}
    font["post"].glyphOrder = glyph_order
    font.sfntVersion = "\x00\x01\x00\x00"
    font.save(dst)


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
