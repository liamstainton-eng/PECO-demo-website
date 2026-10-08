"""Generate public/og-default.jpg (1200x630) from the legacy hero slide.

Run: tools/.venv/Scripts/python.exe -I tools/og/make_og.py
"""
from pathlib import Path
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src/assets/images/legacy/slide1122.jpg"
OUT = ROOT / "public/og-default.jpg"
W, H = 1200, 630

img = Image.open(SRC).convert("RGB")
sw, sh = img.size
# Centre-crop to the 1200:630 ratio, then scale down (source is larger, no upscaling).
ratio = W / H
if sw / sh > ratio:
    cw, ch = round(sh * ratio), sh
else:
    cw, ch = sw, round(sw / ratio)
left, top = (sw - cw) // 2, (sh - ch) // 2
img = img.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS)
img = ImageEnhance.Brightness(img).enhance(0.85)
img.save(OUT, "JPEG", quality=82, optimize=True, progressive=True)
print(f"wrote {OUT} {img.size}")
