"""The same model written as Typst and as DOCX, under one layout profile.

The profile is what #118 calls the Word-compatible settings: every length the
two layouts depend on is set explicitly and to the same value on both sides.

- Lines: a constant pitch per text size. Typst: `par.leading` 0 and the text's
  top and bottom edges set so a line box is exactly the pitch, with the
  descender below the baseline. Word: exact line spacing of the pitch.
- Space between blocks: one gap before each block. Typst: `par.spacing` and
  block spacing 0, then a weak `#v(gap)` between blocks (weak spacing goes away
  at the top of a page). Word: `w:spacing w:before`, nothing after.
- Line breaking: greedy (`par.linebreaks: "simple"`), no hyphenation, ragged
  right, unless the profile asks otherwise.
- Lists: the number in an 18 pt box, the text after it, in both.
"""

import uuid
import zipfile
from xml.sax.saxutils import escape

PT = 20  # twips per point

HEADING = {1: (18, 22), 2: (16, 20), 3: (14, 18), 4: (12, 16), 5: (11, 14), 6: (11, 14)}  # size, pitch


def profile(**overrides):
    p = dict(
        font="Libertinus Serif",
        size=11,
        pitch=14,
        margin=72,
        descender=0.246,  # Libertinus Serif's hhea descender, em
        gap_par=6,
        gap_heading=12,
        gap_after_heading=3,
        gap_item=2,
        gap_table=8,
        cell_inset=5,
        rule=0.5,
        list_indent=18,
        justify=False,
        linebreaks="simple",
        hyphenate=False,
        kerning=True,  # Typst kerns by default; Word only with w:kern
        ligatures=True,
        widows=True,
        page_top_space=False,  # Word: keep space before at the top of a page (Typst drops weak spacing)
        fonts=None,  # directory with the OTF faces, for column widths
        embed=None,  # {"Regular" | "Bold" | "Italic" | "BoldItalic": font file} to embed in the DOCX
        engine=None,  # the engine's LAYOUT_PROFILE (Typst source): it replaces the text and par settings, pitch 1.3em
    )
    p.update(overrides)
    return p


def gaps(blocks, p):
    """The gap before each block, in points (0 for the first)."""
    out = []
    prev = None
    for b in blocks:
        kind = b[0]
        if prev is None:
            g = 0
        elif kind == "t" or prev == "t":
            g = p["gap_table"]
        elif kind == "h":
            g = p["gap_heading"]
        elif prev == "h":
            g = p["gap_after_heading"]
        elif kind == "li" and prev == "li":
            g = p["gap_item"]
        else:
            g = p["gap_par"]
        out.append(g)
        prev = kind
    return out


def size_of(b, p):
    size, pitch = HEADING[b[1]] if b[0] == "h" else (p["size"], p["pitch"])
    return (size, round(1.3 * size, 2)) if p["engine"] else (size, pitch)


def text_width(p):
    return 595.28 - 2 * p["margin"]


def _cell_runs(runs, header):
    return [(t, b or header, i) for t, b, i in runs]


_ADVANCES = {}


def _width(text, bold, italic, p):
    """Text's advance width in points, from the font's hmtx (no kerning: a little wide, which is safe)."""
    face = "Bold" if bold else "Italic" if italic else "Regular"
    if face not in _ADVANCES:
        from fontTools.ttLib import TTFont

        path = p["fonts"] / f"LibertinusSerif-{face}.otf"
        f = TTFont(path if path.exists() else path.with_suffix(".ttf"))
        cmap, hmtx, upm = f.getBestCmap(), f["hmtx"].metrics, f["head"].unitsPerEm
        _ADVANCES[face] = (cmap, hmtx, upm)
    cmap, hmtx, upm = _ADVANCES[face]
    return sum(hmtx.get(cmap.get(ord(c), ".notdef"), (500, 0))[0] for c in text) * p["size"] / upm


def column_widths(rows, p):
    """Typst-`auto`-like widths: every column fits its longest word; columns that fit on one line get their
    natural width; otherwise what's left over is shared in proportion to how much more each column wants.
    Both writers use these, as the exporter will use Typst's resolved widths."""
    n = len(rows[0][1])
    pad = 2 * p["cell_inset"] + 1
    least = [0.0] * n
    natural = [0.0] * n
    for header, cells in rows:
        for j, runs in enumerate(cells):
            full = sum(_width(t, b or header, i, p) for t, b, i in runs)
            words = [_width(w, b or header, i, p) for t, b, i in runs for w in t.split()]
            least[j] = max(least[j], max(words, default=0) + pad)
            natural[j] = max(natural[j], full + pad)
    room = text_width(p)
    if sum(natural) <= room:
        return [round(w, 2) for w in natural]
    if sum(least) > room:
        return None  # Typst would overflow too: not a table this spike compares
    extra = room - sum(least)
    want = [nat - lo for nat, lo in zip(natural, least)]
    return [round(lo + extra * w / sum(want), 2) for lo, w in zip(least, want)]


# --- Typst ------------------------------------------------------------------------------------

def _tstr(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _truns(runs):
    out = []
    for text, b, i in runs:
        e = _tstr(text)
        if b and i:
            e = f"strong(emph({e}))"
        elif b:
            e = f"strong({e})"
        elif i:
            e = f"emph({e})"
        out.append("#" + e)
    return "".join(out)


def _edges(size, pitch, p):
    d = round(p["descender"] * size, 3)
    return f"top-edge: {round(pitch - d, 3)}pt, bottom-edge: {-d}pt"


def typst(blocks, p):
    s, pitch = p["size"], p["pitch"]
    if p["engine"]:
        # The engine's profile sets the edges, leading, breaking and hyphenation; the gaps stay the spike's.
        lines = [
            f"#set page(width: 595.28pt, height: 841.89pt, margin: {p['margin']}pt)",
            f'#set text(font: "{p["font"]}", size: {s}pt, lang: "en", '
            f'kerning: {str(p["kerning"]).lower()}, ligatures: {str(p["ligatures"]).lower()})',
            p["engine"].rstrip(),
            "#set par(spacing: 0pt)",
            "#set block(spacing: 0pt)",
            "#show heading: set block(above: 0pt, below: 0pt)",
            "#set heading(numbering: none)",
        ]
        lines += [f"#show heading.where(level: {lv}): set text(size: {hs}pt)" for lv, (hs, _) in HEADING.items()]
        return _typst_body(blocks, p, lines)
    lines = [
        f"#set page(width: 595.28pt, height: 841.89pt, margin: {p['margin']}pt)",
        f'#set text(font: "{p["font"]}", size: {s}pt, lang: "en", hyphenate: {str(p["hyphenate"]).lower()}, '
        f'kerning: {str(p["kerning"]).lower()}, ligatures: {str(p["ligatures"]).lower()}, {_edges(s, pitch, p)})',
        f'#set par(leading: 0pt, spacing: 0pt, justify: {str(p["justify"]).lower()}, linebreaks: "{p["linebreaks"]}")',
        "#set block(spacing: 0pt)",
        "#show heading: set block(above: 0pt, below: 0pt)",
        "#set heading(numbering: none)",
    ]
    if not p["widows"]:
        lines.append("#set text(costs: (widow: 0%, orphan: 0%))")
    for level, (hs, hp) in HEADING.items():
        lines.append(f"#show heading.where(level: {level}): set text(size: {hs}pt, {_edges(hs, hp, p)})")
    return _typst_body(blocks, p, lines)


def _typst_body(blocks, p, lines):
    w = p["list_indent"]
    lines.append(f"#set enum(indent: 0pt, body-indent: 0pt, spacing: 0pt, numbering: n => box(width: {w}pt)[#n.])")
    lines.append(f"#set list(indent: 0pt, body-indent: 0pt, spacing: 0pt, marker: box(width: {w}pt)[•])")
    # A row stays on one page, as Word rows with w:cantSplit do.
    lines.append("#set table.cell(breakable: false)")
    for b, g in zip(blocks, gaps(blocks, p)):
        if g:
            lines.append(f"#v({g}pt, weak: true)")
        if b[0] == "p":
            lines.append(_truns(b[1]))
        elif b[0] == "h":
            lines.append(f"#heading(level: {b[1]})[{_truns(b[2])}]")
        elif b[0] == "t":
            rows = b[1]
            widths = column_widths(rows, p)
            # Leading header rows repeat on every page, as Word's w:tblHeader rows do.
            k = next((i for i, (h, _) in enumerate(rows) if not h), len(rows))
            cell = lambda h, c: f"[{_truns(_cell_runs(c, h))}]"  # noqa: E731
            head = ", ".join(cell(True, c) for _, cs in rows[:k] for c in cs)
            rest = ", ".join(cell(h, c) for h, cs in rows[k:] for c in cs)
            cells = ", ".join(x for x in (f"table.header({head})" if head else "", rest) if x)
            lines.append(
                f"#table(columns: ({', '.join(f'{w}pt' for w in widths)},), inset: {p['cell_inset']}pt, "
                f"stroke: {p['rule']}pt, align: left + top, {cells})"
            )
        elif b[1]:
            lines.append(f"#enum(start: {b[2]})[{_truns(b[3])}]")
        else:
            lines.append(f"#list[{_truns(b[3])}]")
        lines.append("")
    return "\n".join(lines) + "\n"


# --- DOCX -------------------------------------------------------------------------------------

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"'
)


def _rpr(p, size=None, bold=False, italic=False):
    x = ""
    if bold:
        x += "<w:b/><w:bCs/>"
    if italic:
        x += "<w:i/><w:iCs/>"
    if size:
        x += f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/>'
    return f"<w:rPr>{x}</w:rPr>" if x else ""


def _runs(runs, p, size=None, bold=False):
    return "".join(
        f'<w:r>{_rpr(p, size, bold or b, i)}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>' for t, b, i in runs
    )


def _ppr(gap, pitch, p, before="", after=""):
    """Paragraph properties. OOXML fixes their order (CT_PPrBase): keepNext, keepLines, numPr come
    before spacing; jc and outlineLvl after it. Word reports other orders as unreadable content."""
    jc = '<w:jc w:val="both"/>' if p["justify"] else ""
    return (
        f'<w:pPr>{before}<w:spacing w:before="{round(gap * PT)}" w:after="0" '
        f'w:line="{round(pitch * PT)}" w:lineRule="exact"/>{jc}{after}</w:pPr>'
    )


def _table(rows, p):
    """Fixed column widths and cell margins equal to Typst's insets; 0.5 pt single borders. Word adds a
    horizontal border's width to the row's height, where Typst draws its stroke over the inset, so the
    top and bottom margins give up half of it each. Rows don't split across pages (Typst: breakable: false)."""
    widths = [round(w * PT) for w in column_widths(rows, p)]
    m = round(p["cell_inset"] * PT)
    mv = round((p["cell_inset"] - p["rule"] / 2) * PT)
    sz = round(p["rule"] * 8)
    border = "".join(
        f'<w:{side} w:val="single" w:sz="{sz}" w:space="0" w:color="000000"/>'
        for side in ("top", "left", "bottom", "right", "insideH", "insideV")
    )
    pr = (
        f'<w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>'
        f"<w:tblBorders>{border}</w:tblBorders><w:tblLayout w:type=\"fixed\"/>"
        f'<w:tblCellMar><w:top w:w="{mv}" w:type="dxa"/><w:left w:w="{m}" w:type="dxa"/>'
        f'<w:bottom w:w="{mv}" w:type="dxa"/><w:right w:w="{m}" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    )
    grid = "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in widths) + "</w:tblGrid>"
    trs = []
    leading = True
    for header, cells in rows:
        leading = leading and header
        tcs = "".join(
            f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/></w:tcPr>'
            f"<w:p>{_ppr(0, p['pitch'], p)}{_runs(_cell_runs(c, header), p)}</w:p></w:tc>"
            for w, c in zip(widths, cells)
        )
        trpr = "<w:trPr><w:cantSplit/>" + ("<w:tblHeader/>" if leading else "") + "</w:trPr>"
        trs.append(f"<w:tr>{trpr}{tcs}</w:tr>")
    return f"<w:tbl>{pr}{grid}{''.join(trs)}</w:tbl>"


def _numbering(blocks):
    """One w:num per list item, each restarting at the item's own number (the model keeps them)."""
    nums = []
    for b in blocks:
        if b[0] == "li":
            nums.append((0 if b[1] else 1, b[2]))
    return nums


def docx(blocks, p, path):
    nums = _numbering(blocks)
    body = []
    n = 0
    for b, g in zip(blocks, gaps(blocks, p)):
        size, pitch = size_of(b, p)
        if b[0] == "p":
            body.append(f"<w:p>{_ppr(g, pitch, p)}{_runs(b[1], p)}</w:p>")
        elif b[0] == "t":
            if g and body and body[-1].startswith("<w:p>"):
                # Tables have no space before: the paragraph before them gets it after.
                body[-1] = body[-1].replace('w:after="0"', f'w:after="{round(g * PT)}"', 1)
            body.append(_table(b[1], p))
            continue
        elif b[0] == "h":
            keep = "<w:keepNext/><w:keepLines/>"
            level = f'<w:outlineLvl w:val="{b[1] - 1}"/>'
            body.append(f"<w:p>{_ppr(g, pitch, p, keep, level)}{_runs(b[2], p, size, True)}</w:p>")
        else:
            n += 1
            extra = f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{n}"/></w:numPr>'
            body.append(f"<w:p>{_ppr(g, pitch, p, extra)}{_runs(b[3], p)}</w:p>")
    m = p["margin"] * PT
    sect = (
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        f'<w:pgMar w:top="{m}" w:right="{m}" w:bottom="{m}" w:left="{m}" w:header="0" w:footer="0" w:gutter="0"/>'
        "</w:sectPr>"
    )
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{"".join(body)}{sect}</w:body></w:document>'

    kern = '<w:kern w:val="2"/>' if p["kerning"] else ""
    lig = '<w14:ligatures w14:val="standard"/>' if p["ligatures"] else ""
    widow = "<w:widowControl/>" if p["widows"] else '<w:widowControl w:val="0"/>'
    f = escape(p["font"])
    styles = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {NS}>'
        "<w:docDefaults><w:rPrDefault><w:rPr>"
        f'<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}" w:eastAsia="{f}"/>'
        f'{kern}<w:sz w:val="{p["size"] * 2}"/><w:szCs w:val="{p["size"] * 2}"/><w:lang w:val="en-GB"/>{lig}'
        "</w:rPr></w:rPrDefault>"
        f'<w:pPrDefault><w:pPr>{widow}<w:spacing w:before="0" w:after="0" w:line="{p["pitch"] * PT}" w:lineRule="exact"/></w:pPr></w:pPrDefault>'
        "</w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        "</w:styles>"
    )
    w = p["list_indent"] * PT
    abstract = []
    for aid, (fmt, text) in enumerate([("decimal", "%1."), ("bullet", "•")]):
        abstract.append(
            f'<w:abstractNum w:abstractNumId="{aid}"><w:multiLevelType w:val="singleLevel"/>'
            f'<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/>'
            f'<w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="{w}"/></w:tabs>'
            f'<w:ind w:left="{w}" w:hanging="{w}"/></w:pPr></w:lvl></w:abstractNum>'
        )
    numdefs = "".join(
        f'<w:num w:numId="{i + 1}"><w:abstractNumId w:val="{aid}"/>'
        f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="{start}"/></w:lvlOverride></w:num>'
        for i, (aid, start) in enumerate(nums)
    )
    numbering = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {NS}>{"".join(abstract)}{numdefs}</w:numbering>'

    hyph = '<w:autoHyphenation w:val="true"/>' if p["hyphenate"] else '<w:autoHyphenation w:val="false"/>'
    embed = "<w:embedTrueTypeFonts/>" if p["embed"] else ""
    settings = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {NS}>{embed}'
        f'<w:defaultTabStop w:val="720"/>{hyph}<w:characterSpacingControl w:val="doNotCompress"/>'
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
        "</w:settings>"
    )

    font_entry = f'<w:font w:name="{f}">'
    font_rels = ""
    font_parts = {}
    # `embed`: {"Regular": path, "Bold": path, "Italic": path, "BoldItalic": path}, any of them.
    for i, (face, font) in enumerate((p["embed"] or {}).items(), 1):
        key = uuid.uuid4()
        font_entry += f'<w:embed{face} r:id="rIdFont{i}" w:fontKey="{{{str(key).upper()}}}"/>'
        font_rels += (
            f'<Relationship Id="rIdFont{i}" '
            f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font{i}.odttf"/>'
        )
        font_parts[f"word/fonts/font{i}.odttf"] = _obfuscate(open(font, "rb").read(), key)
    font_entry += "</w:font>"
    font_table = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts {NS}>{font_entry}</w:fonts>'

    ct = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{R}styles" Target="styles.xml"/>'
        f'<Relationship Id="rId2" Type="{R}settings" Target="settings.xml"/>'
        f'<Relationship Id="rId3" Type="{R}numbering" Target="numbering.xml"/>'
        f'<Relationship Id="rId4" Type="{R}fontTable" Target="fontTable.xml"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/settings.xml", settings)
        z.writestr("word/numbering.xml", numbering)
        z.writestr("word/fontTable.xml", font_table)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        if font_parts:
            z.writestr(
                "word/_rels/fontTable.xml.rels",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{font_rels}</Relationships>',
            )
            for name, data in font_parts.items():
                z.writestr(name, data)


def _obfuscate(data: bytes, key: uuid.UUID) -> bytes:
    """ECMA-376 Part 1, 17.8.1: XOR the first 32 bytes with the key's bytes, reversed, twice over."""
    k = bytes.fromhex(key.hex)[::-1]
    head = bytes(b ^ k[i % 16] for i, b in enumerate(data[:32]))
    return head + data[32:]
