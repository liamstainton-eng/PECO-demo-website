"""Crop datasheet PNGs into verification crops and product-page drawings.

Run from the repo root:  python -I tools/datasheets/crop_tables.py

The hard-coded boxes in SHEETS are the source of truth. All boxes are
(left, top, right, bottom) in SOURCE pixels, right/bottom exclusive (PIL style).

Outputs, per model <m>:
  docs/datasheet-verification/<m>/table@3x.png         full table, 3x LANCZOS
  docs/datasheet-verification/<m>/table-rows-<n>@5x.png ~4-row strips, 5x LANCZOS,
                                                        header row repeated on top
  docs/datasheet-verification/<m>/options@2x.png       options list, 2x LANCZOS
  src/assets/images/products/<m>-drawing.png           drawing region, 1x (no upscale)

Idempotent: stale table-rows-*.png are removed before each run, and the output
is a pure function of the source PNGs and the boxes below.
"""
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
LEGACY = ROOT / "src" / "assets" / "images" / "legacy"
DOCS = ROOT / "docs" / "datasheet-verification"
PRODUCTS = ROOT / "src" / "assets" / "images" / "products"

ROWS_PER_STRIP = 4  # target; strips are balanced so none is left with 1-2 rows

# table: full table incl. header and outer border (about 6px padding).
# header_bottom: y of the line under the header row (source pixels).
# table_bottom: y of the last horizontal line of the table (source pixels).
# n_rows: number of data rows (used to interpolate row lines for strips).
# options: title + options list (+ attenuation line where present).
# drawing: dimension drawing only (no note bar, no logo, no table).
SHEETS = {
    "sea": {
        "file": "PECO-SEA-.png",
        "table": (24, 415, 942, 635),
        "header_bottom": 461, "table_bottom": 628, "n_rows": 11,
        "options": (55, 158, 300, 382),
        "drawing": (303, 33, 940, 372),
    },
    "se20": {
        "file": "PECO_SE20-.png",
        "table": (27, 419, 948, 639),
        "header_bottom": 468, "table_bottom": 633, "n_rows": 10,
        "options": (30, 138, 300, 412),
        "drawing": (368, 18, 985, 372),
    },
    "se30": {
        "file": "PECO_SE30-.png",
        "table": (41, 415, 900, 665),
        "header_bottom": 461, "table_bottom": 658, "n_rows": 13,
        "options": (45, 175, 300, 410),
        "drawing": (348, 38, 940, 372),
    },
    "se40": {
        "file": "PECO_SE40-.png",
        "table": (41, 411, 910, 661),
        "header_bottom": 442, "table_bottom": 655, "n_rows": 14,
        "options": (45, 175, 330, 405),
        "drawing": (342, 38, 948, 372),
    },
    "se50": {
        "file": "PECO_SE50-.png",
        "table": (41, 401, 900, 665),
        "header_bottom": 446, "table_bottom": 659, "n_rows": 14,
        "options": (45, 158, 330, 382),
        "drawing": (336, 28, 930, 356),
    },
    "sls": {
        "file": "PECO_SLS-.png",
        "table": (10, 324, 966, 645),
        "header_bottom": 350, "table_bottom": 639, "n_rows": 19,
        "options": (45, 125, 315, 322),
        "drawing": (320, 0, 962, 294),
    },
    "sa1": {
        "file": "Peco_SA1_SPARK_ARRESTOR.png",
        "table": (18, 326, 768, 530),
        "header_bottom": 350, "table_bottom": 523, "n_rows": 14,
        "options": (48, 133, 302, 322),
        "drawing": (316, 30, 770, 292),
    },
}


def load_flat(path):
    """Open an RGBA/RGB PNG and flatten it onto white."""
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def scaled(im, factor):
    return im.resize((im.width * factor, im.height * factor), Image.LANCZOS)


def has_long_hline(im, y, x0, x1, tol=3):
    """True if a dark, mostly continuous horizontal line exists within tol px of y."""
    g = im.convert("L").point(lambda v: 255 if v < 160 else 0)
    w = g.width
    d = g.tobytes()
    need = 0.5 * (x1 - x0)
    for yy in range(max(0, y - tol), min(g.height, y + tol + 1)):
        if d[yy * w + x0:yy * w + x1].count(255) >= need:
            return True
    return False


def row_lines(im, sheet):
    """y of each row boundary (header_bottom ... table_bottom).

    Interpolated first, then snapped to the darkest horizontal rule within
    +/-3px so strip cuts follow the real table rules.
    """
    hb, tb, n = sheet["header_bottom"], sheet["table_bottom"], sheet["n_rows"]
    x0, _, x1, _ = sheet["table"]
    g = im.convert("L").point(lambda v: 255 if v < 160 else 0)
    w, d = g.width, g.tobytes()
    lines = []
    for i in range(n + 1):
        y = round(hb + (tb - hb) * i / n)
        best = max(range(y - 3, y + 4),
                   key=lambda yy: (d[yy * w + x0:yy * w + x1].count(255), -abs(yy - y)))
        lines.append(best)
    return lines


def strip_groups(n_rows):
    n_strips = -(-n_rows // ROWS_PER_STRIP)
    base, extra = divmod(n_rows, n_strips)
    sizes = [base + (1 if i < extra else 0) for i in range(n_strips)]
    groups, start = [], 0
    for s in sizes:
        groups.append((start, start + s))
        start += s
    return groups


def make_strips(im, sheet, out_dir):
    x0, ty, x1, _ = sheet["table"]
    lines = row_lines(im, sheet)
    header = im.crop((x0, ty, x1, lines[0] + 2))
    strips = []
    for k, (a, b) in enumerate(strip_groups(sheet["n_rows"]), start=1):
        top = lines[0] + 2 if a == 0 else lines[a]
        body = im.crop((x0, top, x1, lines[b] + 2))
        strip = Image.new("RGB", (header.width, header.height + body.height), "white")
        strip.paste(header, (0, 0))
        strip.paste(body, (0, header.height))
        name = f"table-rows-{k}@5x.png"
        scaled(strip, 5).save(out_dir / name)
        strips.append((name, a + 1, b))
    return strips


def process(model, sheet):
    im = load_flat(LEGACY / sheet["file"])
    x0, ty, x1, ty1 = sheet["table"]
    for key in ("table", "options", "drawing"):
        l, t, r, b = sheet[key]
        assert 0 <= l < r <= im.width and 0 <= t < b <= im.height, f"{model}.{key} out of bounds {im.size}"
    for label, y in (("header_bottom", sheet["header_bottom"]), ("table_bottom", sheet["table_bottom"])):
        if not has_long_hline(im, y, x0 + 4, x1 - 4):
            print(f"WARNING {model}: no table rule found near {label}={y}", file=sys.stderr)

    out_dir = DOCS / model
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("table-rows-*.png"):
        stale.unlink()

    scaled(im.crop(sheet["table"]), 3).save(out_dir / "table@3x.png")
    strips = make_strips(im, sheet, out_dir)
    scaled(im.crop(sheet["options"]), 2).save(out_dir / "options@2x.png")

    PRODUCTS.mkdir(parents=True, exist_ok=True)
    im.crop(sheet["drawing"]).save(PRODUCTS / f"{model}-drawing.png")
    print(f"{model}: {im.size[0]}x{im.size[1]}, {len(strips)} strips")


def main():
    for model, sheet in SHEETS.items():
        process(model, sheet)


if __name__ == "__main__":
    main()
