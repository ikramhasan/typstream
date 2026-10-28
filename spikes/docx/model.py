"""A document as the spike's two writers see it, read from Typst's HTML export.

Blocks: ("h", level, runs), ("p", runs), ("li", ordered, number, runs), and
with `tables`, ("t", rows): rows of (header?, [cell runs]), one paragraph per
cell, every row as many cells as the first (anything else drops the table).
Runs: (text, bold, italic). Elements the model has no block for (math,
figures, edu's drawings and answer boxes) are counted and left out: the spike
measures how Word-like layout engines break the lines of the same text, not
how those elements map (#118's mapping table).
"""

from html.parser import HTMLParser

BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li"}
SKIP = {"math", "svg", "figure", "table", "pre", "img", "script", "style", "head"}
# Elements with no end tag: they never open anything to skip past.
VOID = {"meta", "link", "br", "hr", "img", "input", "col", "wbr", "source", "area", "base", "embed", "track"}


class _Reader(HTMLParser):
    def __init__(self, tables=False):
        super().__init__(convert_charrefs=True)
        self.tables = tables
        self.table = None  # {"rows": [...], "dropped": bool, "depth": int} while inside one
        self.cell = None  # runs of the cell being read
        self.blocks = []
        self.skipped = {}
        self.skip_depth = 0
        self.cur = None  # (kind, meta, runs)
        self.bold = 0
        self.italic = 0
        self.lists = []  # [ordered, next number]

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.table is not None and not self.skip_depth:
            self._table_start(tag, a)
            return
        if self.tables and tag == "table" and not self.skip_depth:
            self._flush()
            self.table = {"rows": [], "dropped": False, "depth": 1}
            return
        if tag in VOID and tag != "br":
            if tag == "img" and not self.skip_depth:
                self.skipped["img"] = self.skipped.get("img", 0) + 1
                if self.cur:
                    self.cur = ("dropped",) + self.cur[1:]
            return
        if self.skip_depth or tag in SKIP:
            if not self.skip_depth:
                self.skipped[tag] = self.skipped.get(tag, 0) + 1
                if self.cur:
                    self.cur = ("dropped",) + self.cur[1:]
            self.skip_depth += 1
            return
        if tag in ("ol", "ul"):
            self.lists.append([tag == "ol", int(a.get("start", "1"))])
        elif tag in BLOCK:
            self._flush()
            if tag == "li":
                lst = self.lists[-1] if self.lists else [False, 1]
                n = int(a["value"]) if "value" in a else lst[1]
                lst[1] = n + 1
                self.cur = ("li", (lst[0], n), [])
            elif tag == "p":
                self.cur = ("p", None, [])
            else:
                self.cur = ("h", int(tag[1]), [])
        elif tag == "strong":
            self.bold += 1
        elif tag == "em":
            self.italic += 1
        elif tag == "br" and self.cur:
            self.cur = ("dropped",) + self.cur[1:]

    def handle_endtag(self, tag):
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if self.table is not None:
            self._table_end(tag)
            return
        if tag in ("ol", "ul") and self.lists:
            self._flush()
            self.lists.pop()
        elif tag in BLOCK:
            self._flush()
        elif tag == "strong":
            self.bold -= 1
        elif tag == "em":
            self.italic -= 1

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.table is not None:
            if self.cell is not None:
                self.cell.append((data, self.bold > 0, self.italic > 0))
            return
        if self.cur is None:
            if data.strip():
                # Text outside a block (a div's own text): a paragraph of its own.
                self.cur = ("p", None, [])
            else:
                return
        self.cur[2].append((data, self.bold > 0, self.italic > 0))

    def _table_start(self, tag, a):
        t = self.table
        if tag in ("strong", "b"):
            self.bold += 1
        elif tag == "em":
            self.italic += 1
        elif tag == "tr":
            t["rows"].append([False, []])
        elif tag in ("td", "th"):
            if "colspan" in a or "rowspan" in a or not t["rows"]:
                t["dropped"] = True
            self.cell = []
            if tag == "th":
                t["rows"][-1][0] = True
        elif tag in ("thead", "tbody", "tfoot", "span"):
            pass
        elif tag in VOID and tag != "br":
            t["dropped"] = True
        else:
            # Lists, paragraphs, math, breaks, nested tables in a cell: not one plain paragraph.
            t["dropped"] = True
            if tag not in VOID:
                t["depth"] += tag == "table"

    def _table_end(self, tag):
        t = self.table
        if tag in ("strong", "b"):
            self.bold -= 1
        elif tag == "em":
            self.italic -= 1
        elif tag in ("td", "th") and self.cell is not None and t["rows"]:
            t["rows"][-1][1].append(_tidy(self.cell))
            self.cell = None
        elif tag == "table":
            t["depth"] -= 1
            if t["depth"] == 0:
                self.table = None
                rows = [(h, cells) for h, cells in t["rows"] if cells]
                if t["dropped"] or not rows or any(len(c) != len(rows[0][1]) for _, c in rows):
                    self.skipped["table"] = self.skipped.get("table", 0) + 1
                else:
                    self.blocks.append(("t", rows))

    def _flush(self):
        if not self.cur:
            return
        kind, meta, runs = self.cur
        self.cur = None
        text = "".join(r[0] for r in runs)
        if kind == "dropped":
            self.skipped["block with math or a break"] = self.skipped.get("block with math or a break", 0) + 1
            return
        if not text.strip():
            return
        runs = _tidy(runs)
        if kind == "p":
            self.blocks.append(("p", runs))
        elif kind == "h":
            self.blocks.append(("h", meta, runs))
        else:
            self.blocks.append(("li", meta[0], meta[1], runs))


def _tidy(runs):
    """Whitespace collapsed as HTML does, adjacent runs of one style merged."""
    out = []
    prev_space = True
    for text, b, i in runs:
        t = " ".join(text.split())
        if text[:1].isspace() and not prev_space:
            t = " " + t
        if text[-1:].isspace() and t and not t.endswith(" "):
            t = t + " "
        if not t.strip():
            if t and not prev_space:
                t = " "
            else:
                continue
        prev_space = t.endswith(" ")
        if out and out[-1][1] == b and out[-1][2] == i:
            out[-1] = (out[-1][0] + t, b, i)
        else:
            out.append((t, b, i))
    if out:
        out[0] = (out[0][0].lstrip(), out[0][1], out[0][2])
        out[-1] = (out[-1][0].rstrip(), out[-1][1], out[-1][2])
    return [r for r in out if r[0]]


def read(html: str, tables=False):
    r = _Reader(tables)
    r.feed(html)
    r._flush()
    return r.blocks, r.skipped
