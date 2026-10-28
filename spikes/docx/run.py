"""#118 spike: do LibreOffice and ONLYOFFICE break lines and pages where Typst does?

For each corpus document: Typst's HTML export → model.py's blocks → the same
blocks as Typst and as DOCX (writers.py) under a profile → PDFs from native
typst, LibreOffice (headless) and ONLYOFFICE (x2t, in Docker) → every line's
words and page (pdftotext -bbox) → how many of Typst's lines each renderer
has, in order, and whether its pages start with the same lines.

    python run.py [--out DIR] [--only NAME,...] [--variants base,justify,...] [--no-oo]

Fonts: only the engine's (packages/engine-wasm/dist/fonts), for all three:
typst --ignore-system-fonts, LibreOffice through a fontconfig file listing
that directory alone, ONLYOFFICE through an AllFonts.js built from it.
"""

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import unicodedata
from html import unescape
from pathlib import Path

import model
import writers

ROOT = Path(__file__).resolve().parents[2]
# The engine's fonts. The spike reads a copy (fonts/ in --out), never these.
ENGINE_FONTS = ROOT / "packages/engine-wasm/dist/fonts"
FONTS = None  # set by main(): the copy
TTF_FONTS = None  # set by main(): Libertinus converted to TrueType outlines (otf2ttf.py), DejaVu Sans Mono
CORPUS = ROOT / "corpus"


def corpus_docs():
    """`set/name` of every edu document and every llm one that compiles (`expect` ok), and `long`."""
    docs = [f"edu/{p.stem}" for p in sorted((CORPUS / "edu").glob("*.typ"))]
    meta = json.loads((CORPUS / "llm/meta.json").read_text())
    docs += [f"llm/{n}" for n, m in sorted(meta.items()) if m.get("expect", "ok") == "ok"]
    return docs + ["long"]

VARIANTS = {
    # The Word-compatible profile.
    "base": {},
    # Justified text: Typst's optimizing line breaker against Word's greedy justification.
    "justify": dict(justify=True, linebreaks="optimized"),
    # Justified, but Typst breaks greedily too.
    "justify-simple": dict(justify=True, linebreaks="simple"),
    # Hyphenation on both sides (different dictionaries and rules).
    "hyphenate": dict(hyphenate=True),
    # No kerning in the DOCX (Word's default for new text), Typst kerns.
    "no-kern-docx": dict(kerning="docx-off"),
    # Typst's default line breaking for ragged text is already simple; this is Typst's default text/par setup
    # (cap-height/baseline edges, 0.65em leading, 1.2em spacing) against the DOCX's exact lines: page breaks drift.
    "typst-defaults": dict(typst_defaults=True),
    # The regular face embedded in the DOCX, and LibreOffice/ONLYOFFICE without the font installed.
    "embedded": dict(embed="otf", installed=False),
    # Libertinus converted to TrueType outlines (what Word embeds), for Typst and both renderers.
    "ttf": dict(fonts="ttf"),
    # The TrueType faces embedded, nothing installed.
    "ttf-embedded": dict(fonts="ttf", embed="ttf", installed=False),
}


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def packages(out):
    """A package directory with @typstream/edu and the vendored Universe packages, as corpus:validate builds."""
    import tarfile
    pk = out / "packages"
    if pk.exists():
        return pk
    edu = ROOT / "packages/edu/typst"
    version = re.search(r'^version = "(.+)"$', (edu / "typst.toml").read_text(), re.M)[1]
    shutil.copytree(edu, pk / "typstream/edu" / version)
    for t in (ROOT / "packages/universe/vendor").glob("*.tar.gz"):
        name, v = re.match(r"^(.+)-(\d+\.\d+\.\d+)\.tar\.gz$", t.name).groups()
        with tarfile.open(t) as tar:
            tar.extractall(pk / "preview" / name / v, filter="data")
    return pk


def html_of(doc, out):
    """Typst's HTML export of a corpus document (llm ones with edu's preamble, as their meta asks)."""
    set_, name = doc.split("/")
    src = CORPUS / set_ / f"{name}.typ"
    if set_ == "llm":
        edu = re.search(r'^version = "(.+)"$', (ROOT / "packages/edu/typst/typst.toml").read_text(), re.M)[1]
        copy = CORPUS / set_ / f"{name}.typ.docx-spike"
        copy.write_text(f'#import "@typstream/edu:{edu}": *\n' + src.read_text())
        src = copy
    path = out / f"{doc.replace('/', '__')}.html"
    try:
        sh(["typst", "compile", "--features", "html", "--format", "html", "--root", str(CORPUS),
            "--package-path", str(packages(out)), "--package-cache-path", str(out / "no-cache"),
            "--ignore-system-fonts", "--font-path", str(FONTS), str(src), str(path)])
    finally:
        if set_ == "llm":
            src.unlink()
    return path.read_text()


def typst_pdf(typ, pdf, fonts):
    sh(["typst", "compile", "--ignore-system-fonts", "--ignore-embedded-fonts", "--font-path", str(fonts),
        str(typ), str(pdf)])


def fontconfig(out, fonts):
    conf = out / f"fonts-{fonts.name}.conf"
    conf.write_text(
        f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        f"<dir>{fonts}</dir><cachedir>{out / 'fc-cache'}</cachedir></fontconfig>"
    )
    return conf


def other_fonts(out):
    """A font directory without Libertinus: only DejaVu Sans Mono (x2t crashes with no fonts at all)."""
    d = out / "other-fonts"
    d.mkdir(exist_ok=True)
    shutil.copy(FONTS / "DejaVuSansMono.ttf", d)
    return d


def lo_pdfs(docxs, outdir, conf):
    """LibreOffice runs of 40 files, in its own profile, seeing only `conf`'s fonts. A batch now and then
    skips a file without saying so: those are tried again alone, and left out if they fail again."""
    env = dict(os.environ, FONTCONFIG_FILE=str(conf), SAL_USE_VCLPLUGIN="svp")
    profile = outdir / "lo-profile"
    tmp = outdir / "lo-tmp"
    tmp.mkdir(exist_ok=True)

    def convert(batch):
        try:
            sh(["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "pdf",
                "--outdir", str(tmp), *map(str, batch)], env=env, timeout=600)
        except subprocess.SubprocessError:
            pass
        for d in batch:
            if (tmp / (d.stem + ".pdf")).exists():
                shutil.move(tmp / (d.stem + ".pdf"), d.with_suffix(".lo.pdf"))

    for i in range(0, len(docxs), 40):
        convert(docxs[i : i + 40])
    for d in docxs:
        if not d.with_suffix(".lo.pdf").exists():
            convert([d])


OO_SCRIPT = r"""
set -e
DIR=/var/www/onlyoffice/documentserver
BIN=$DIR/server/FileConverter/bin
export LD_LIBRARY_PATH=$BIN
$DIR/server/tools/allfontsgen --input=/fonts --allfonts=$BIN/AllFonts.js --selection=$BIN/font_selection.bin \
  --use-system=false > /dev/null
cd $BIN
for f in "$@"; do
  cat > /tmp/p.xml <<EOF
<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert><m_sFileFrom>/work/$f.docx</m_sFileFrom><m_sFileTo>/work/$f.oo.pdf</m_sFileTo>
<m_nFormatTo>513</m_nFormatTo><m_sFontDir>/fonts</m_sFontDir><m_bIsNoBase64>true</m_bIsNoBase64></TaskQueueDataConvert>
EOF
  ./x2t /tmp/p.xml > /dev/null 2>&1 || true
  [ -f /work/$f.oo.pdf ] && chown $(stat -c %u:%g /work) /work/$f.oo.pdf || true
done
"""


def oo_pdfs(docxs, outdir, fonts):
    """One ONLYOFFICE container for the batch: a font index of `fonts`, then x2t per file."""
    if not docxs:
        return
    sh(["docker", "run", "--rm", "-v", f"{fonts}:/fonts:ro", "-v", f"{outdir}:/work", "--entrypoint", "bash",
        "onlyoffice/documentserver", "-c", OO_SCRIPT, "x", *[d.stem for d in docxs]], timeout=1200)


WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')
PAGE = re.compile(r"<page [^>]*>(.*?)</page>", re.S)


def lines_of(pdf):
    """[(page, "words of the line")], lines by the bottom of their words' boxes, top to bottom."""
    xml = sh(["pdftotext", "-bbox", str(pdf), "-"]).stdout
    out = []
    for n, page in enumerate(PAGE.findall(xml), 1):
        words = []
        for x0, y0, x1, y1, w in WORD.findall(page):
            t = unicodedata.normalize("NFKC", unescape(w))
            if t:
                words.append((float(y1), float(x0), t))
        words.sort()
        lines = []
        for y, x, t in words:
            if lines and abs(lines[-1][0] - y) < 3:
                lines[-1][1].append((x, t))
            else:
                lines.append([y, [(x, t)]])
        for _, ws in lines:
            out.append((n, " ".join(t for _, t in sorted(ws))))
    return out


def compare(ref, got):
    """How much of `ref` (Typst's lines) `got` reproduces."""
    # Whitespace aside: Typst's PDF has no space after a list number (it's in a box), and which words
    # share a line doesn't depend on it.
    a = [re.sub(r"\s+", "", t) for _, t in ref]
    b = [re.sub(r"\s+", "", t) for _, t in got]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    same = sum(m.size for m in sm.get_matching_blocks())
    words_same = "".join(a) == "".join(b)
    def first(ls, keys):
        return {}.fromkeys(k for i, ((p, _), k) in enumerate(zip(ls, keys)) if i == 0 or ls[i - 1][0] != p)

    starts_ref = list(first(ref, a))
    starts_got = set(first(got, b))
    pages_ref = ref[-1][0] if ref else 0
    pages_got = got[-1][0] if got else 0
    diff = None
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op != "equal":
            diff = {"typst": a[i1:i2][:3], "other": b[j1:j2][:3]}
            break
    return {
        "lines": len(a),
        "same_lines": same,
        "line_agreement": round(same / len(a), 4) if a else 1,
        "same_words": words_same,
        "pages": [pages_ref, pages_got],
        "page_starts_same": sum(1 for t in starts_ref if t in starts_got),
        "page_starts": len(starts_ref),
        "first_difference": diff,
    }


def build(name, blocks, variant, opts, out):
    opts = dict(opts)
    installed = opts.pop("installed", True)
    typst_defaults = opts.pop("typst_defaults", False)
    fonts = TTF_FONTS if opts.pop("fonts", "otf") == "ttf" else FONTS
    embed = opts.pop("embed", None)
    if embed:
        ext = "ttf" if embed == "ttf" else "otf"
        opts["embed"] = {f: str(fonts / f"LibertinusSerif-{f}.{ext}") for f in ("Regular", "Bold", "Italic")}
    kern_docx_off = opts.get("kerning") == "docx-off"
    if kern_docx_off:
        opts["kerning"] = True
    p = writers.profile(fonts=FONTS, **opts)
    stem = f"{name}.{variant}"
    typ = out / f"{stem}.typ"
    src = writers.typst(blocks, p)
    if typst_defaults:
        src = "\n".join(
            line for line in src.splitlines()
            if not line.startswith(("#set par(", "#set block(", "#show heading: set block"))
        )
        src = re.sub(r", top-edge: [-\d.]+pt, bottom-edge: [-\d.]+pt", "", src)
    typ.write_text(src)
    typst_pdf(typ, out / f"{stem}.typst.pdf", fonts)
    if kern_docx_off:
        p["kerning"] = False
    writers.docx(blocks, p, out / f"{stem}.docx")
    # What the renderers see installed: the same fonts, or only DejaVu Sans Mono.
    return out / f"{stem}.docx", fonts if installed else other_fonts(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/docx-spike")
    ap.add_argument("--only")
    ap.add_argument("--variants", default=",".join(VARIANTS))
    ap.add_argument("--no-oo", action="store_true")
    ap.add_argument("--tables", action="store_true", help="keep plain tables (and only documents that have one)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    global FONTS, TTF_FONTS
    FONTS = out / "fonts"
    if not FONTS.exists():
        shutil.copytree(ENGINE_FONTS, FONTS)
    TTF_FONTS = out / "fonts-ttf"
    if not TTF_FONTS.exists():
        import otf2ttf
        TTF_FONTS.mkdir()
        shutil.copy(FONTS / "DejaVuSansMono.ttf", TTF_FONTS)
        for face in ("Regular", "Bold", "Italic"):
            otf2ttf.convert(FONTS / f"LibertinusSerif-{face}.otf", TTF_FONTS / f"LibertinusSerif-{face}.ttf")
    docs = args.only.split(",") if args.only else corpus_docs()
    variants = args.variants.split(",")

    models = {}
    meta = {}
    for doc in docs:
        if doc == "long":
            continue
        try:
            models[doc] = model.read(html_of(doc, out), tables=args.tables)
        except subprocess.CalledProcessError as e:
            meta[doc] = {"error": e.stderr.strip().splitlines()[-1:]}
    if "long" in docs:
        # Every edu document one after the other: page breaks over many pages.
        models["long"] = ([b for d, (bs, _) in models.items() if d.startswith("edu/") for b in bs], {})
    docs = [d for d in docs if d in models and models[d][0]]
    if args.tables:
        # Tables whose longest words don't fit the text width overflow in Typst: left out.
        fit = writers.profile(fonts=FONTS)
        for d in docs:
            blocks, skipped = models[d]
            kept = [b for b in blocks if b[0] != "t" or writers.column_widths(b[1], fit) is not None]
            if len(kept) < len(blocks):
                skipped["table too wide"] = len(blocks) - len(kept)
            models[d] = (kept, skipped)
        docs = [d for d in docs if any(b[0] == "t" for b in models[d][0])]

    batches = {}
    for doc in docs:
        blocks, skipped = models[doc]
        meta[doc] = {"blocks": len(blocks), "skipped": skipped}
        for v in variants:
            d, fonts = build(doc.replace("/", "__"), blocks, v, VARIANTS[v], out)
            batches.setdefault(fonts, []).append(d)

    for fonts, docxs in batches.items():
        lo_pdfs(docxs, out, fontconfig(out, fonts))
        if not args.no_oo:
            oo_pdfs(docxs, out, fonts)

    report = {"documents": meta, "results": []}
    for doc in docs:
        for v in variants:
            stem = f"{doc.replace('/', '__')}.{v}"
            ref = lines_of(out / f"{stem}.typst.pdf")
            row = {"doc": doc, "variant": v}
            engines_here = ["lo"] + ([] if args.no_oo else ["oo"])
            if not all((out / f"{stem}.{e}.pdf").exists() for e in engines_here):
                meta.setdefault("not_converted", []).append(stem)
                continue
            for engine in engines_here:
                row[engine] = compare(ref, lines_of(out / f"{stem}.{engine}.pdf"))
            if v == "ttf" and "base" in variants:
                # Does Typst itself break lines the same with the TrueType conversion?
                base = lines_of(out / f"{doc.replace('/', '__')}.base.typst.pdf")
                row["typst_otf_vs_ttf"] = compare(base, ref)["line_agreement"]
            report["results"].append(row)
    (out / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))

    engines = ["lo"] + ([] if args.no_oo else ["oo"])
    print(f"{'document':44} {'variant':15} " + " ".join(f"{e + ' lines':>14} {e + ' pages':>10}" for e in engines))
    for r in report["results"]:
        cells = []
        for e in engines:
            c = r[e]
            cells.append(f"{c['same_lines']:>5}/{c['lines']:<4}{c['line_agreement'] * 100:5.1f}%"
                         f" {c['page_starts_same']:>4}/{c['page_starts']:<2}{'' if c['same_words'] else ' ≠words'}")
        if any(r[e]["line_agreement"] < 1 or r[e]["page_starts_same"] < r[e]["page_starts"] for e in engines):
            print(f"{r['doc'][:44]:44} {r['variant']:15} " + " ".join(cells))
    for v in variants:
        rows = [r for r in report["results"] if r["variant"] == v]
        summary = []
        for e in engines:
            same = sum(r[e]["same_lines"] for r in rows)
            total = sum(r[e]["lines"] for r in rows)
            ps = sum(r[e]["page_starts_same"] for r in rows)
            pt = sum(r[e]["page_starts"] for r in rows)
            summary.append(f"{e}: {same}/{total} lines ({same / total * 100:.1f}%), {ps}/{pt} pages")
        perfect = {e: sum(1 for r in rows if r[e]["line_agreement"] == 1 and r[e]["page_starts_same"] == r[e]["page_starts"]) for e in engines}
        if v == "ttf":
            ok = sum(1 for r in rows if r.get("typst_otf_vs_ttf") == 1)
            summary.append(f"Typst OTF vs TTF identical lines in {ok}/{len(rows)} documents")
        print(f"TOTAL {v:15} " + "; ".join(summary) + f"; documents identical: " + ", ".join(f"{e} {perfect[e]}/{len(rows)}" for e in engines))


if __name__ == "__main__":
    main()
