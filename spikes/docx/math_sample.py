"""#118 spike: Word equations (OMML) next to Typst's math, in LibreOffice and ONLYOFFICE.

One paragraph with inline math (a fraction, a power, a root) and one display
equation, written by hand as OMML in a DOCX and as Typst math. Renders both,
then writes PNGs of the first page and the equations' widths as each PDF has
them (pdftotext word boxes), so how far each renderer's math is from Typst's
can be seen and measured.

    python math_sample.py [--out DIR] [--math-font NAME]
"""

import argparse
import shutil
import subprocess
import zipfile
from pathlib import Path

import run
import writers

M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'


def r(t):
    return f'<m:r><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}"/></w:rPr><m:t>{t}</m:t></m:r>'


def frac(a, b):
    return f"<m:f><m:num>{a}</m:num><m:den>{b}</m:den></m:f>"


def sup(base, s):
    return f"<m:sSup><m:e>{base}</m:e><m:sup>{s}</m:sup></m:sSup>"


def sqrt(x):
    return f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{x}</m:e></m:rad>'


FONT = "New Computer Modern Math"
AT_LEAST = False

# x = (-b ± √(b² − 4ac)) / 2a, and inline: 3/4 of x², √2.
QUADRATIC = lambda: frac(  # noqa: E731
    r("−") + r("b") + r("±") + sqrt(sup(r("b"), r("2")) + r("−") + r("4") + r("a") + r("c")), r("2") + r("a")
)


def text_run(t):
    return f'<w:r><w:t xml:space="preserve">{t}</w:t></w:r>'


def docx(path, p):
    inline = (
        text_run("The area is ")
        + f"<m:oMath>{frac(r('3'), r('4'))}{sup(r('x'), r('2'))}</m:oMath>"
        + text_run(" square units, and the diagonal of the unit square is ")
        + f"<m:oMath>{sqrt(r('2'))}</m:oMath>"
        + text_run(". Solve every equation below and show each step of your working in the space provided.")
    )
    display = f"<m:oMathPara><m:oMath>{r('x')}{r('=')}{QUADRATIC()}</m:oMath></m:oMathPara>"
    blocks = [("p", [("x", False, False)]), ("p", [("x", False, False)])]
    writers.docx(blocks, p, path)
    # Swap the two placeholder paragraphs' runs for the math ones, and declare the math font.
    with zipfile.ZipFile(path) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = parts["word/document.xml"].decode()
    doc = doc.replace("<w:document ", f"<w:document {M} ", 1)
    placeholder = '<w:r><w:t xml:space="preserve">x</w:t></w:r>'
    doc = doc.replace(placeholder, inline, 1).replace(placeholder, display, 1)
    if AT_LEAST:
        # Exact line spacing clips math (a fraction's numerator, a display equation): let lines with math grow.
        doc = doc.replace('w:lineRule="exact"', 'w:lineRule="atLeast"')
    parts["word/document.xml"] = doc.encode()
    settings = parts["word/settings.xml"].decode()
    settings = settings.replace("<w:settings ", f"<w:settings {M} ", 1).replace(
        "</w:compat>", f'</w:compat><m:mathPr><m:mathFont m:val="{FONT}"/></m:mathPr>'
    )
    parts["word/settings.xml"] = settings.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in parts.items():
            z.writestr(n, data)


TYPST = """The area is $3/4 x^2$ square units, and the diagonal of the unit square is $sqrt(2)$. Solve every
equation below and show each step of your working in the space provided.

#v(6pt, weak: true)
$ x = (-b plus.minus sqrt(b^2 - 4 a c)) / (2 a) $
"""


def main():
    global FONT  # noqa: PLW0603
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/docx-math")
    ap.add_argument("--math-font", default=FONT)
    ap.add_argument("--at-least", action="store_true", help="lines with math at least the pitch, not exactly")
    args = ap.parse_args()
    FONT = args.math_font
    global AT_LEAST
    AT_LEAST = args.at_least
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    run.FONTS = out / "fonts"
    if not run.FONTS.exists():
        shutil.copytree(run.ENGINE_FONTS, run.FONTS)
    p = writers.profile()
    head = writers.typst([], p)
    (out / "math.typ").write_text(head + '#show math.equation: set text(font: "New Computer Modern Math")\n' + TYPST)
    run.typst_pdf(out / "math.typ", out / "math.typst.pdf", run.FONTS)
    docx(out / "math.docx", p)
    run.lo_pdfs([out / "math.docx"], out, run.fontconfig(out, run.FONTS))
    run.oo_pdfs([out / "math.docx"], out, run.FONTS)
    for engine in ("typst", "lo", "oo"):
        pdf = out / f"math.{engine}.pdf"
        subprocess.run(["pdftoppm", "-r", "150", "-f", "1", "-l", "1", "-png", "-singlefile", str(pdf),
                        str(out / f"math.{engine}")], check=True)
        print(engine, [t for _, t in run.lines_of(pdf)][:6])


if __name__ == "__main__":
    main()
