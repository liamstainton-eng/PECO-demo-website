# Datasheet verification crops

Legacy datasheet PNGs (`src/assets/images/legacy/`, git-ignored) are the only source for the
size tables. This folder holds high-resolution crops of each sheet so the tables can be
transcribed and verified by eye. **No table values have been transcribed yet** (gated on a
client answer, see the client questions in the local-only `docs/internal/`).

## How the crops were made

`tools/datasheets/crop_tables.py` (Pillow only, no numpy):

```
tools/.venv/Scripts/python.exe -I tools/datasheets/crop_tables.py
```

- Each source PNG is RGBA; it is flattened onto white before cropping.
- The boxes in `SHEETS` (source pixels, `left, top, right, bottom`) are hard-coded and are the
  source of truth. They were found by viewing each sheet and checking against detected
  horizontal rules, with ~6px padding around the table border.
- Upscaling uses LANCZOS: table 3x, options 2x, row strips 5x. Drawings are cropped at 1x
  (no upscale) for the product page.
- Row strips: about 4 data rows each (balanced, so no strip is left with 1-2 rows), with the
  header row repeated at the top. Row cut lines are interpolated between `header_bottom` and
  `table_bottom`, then snapped to the nearest real horizontal rule (+/-3px).
- The script warns on stderr if no table rule is found near `header_bottom` / `table_bottom`.
- Idempotent: stale `table-rows-*.png` are deleted first; two runs give byte-identical output.

Outputs per model `<m>` (sea, se20, se30, se40, se50, sls, sa1):

| File | Purpose |
| --- | --- |
| `docs/datasheet-verification/<m>/table@3x.png` | full table, for first-pass transcription |
| `docs/datasheet-verification/<m>/table-rows-<n>@5x.png` | ~4-row strips + header, for dispute resolution |
| `docs/datasheet-verification/<m>/options@2x.png` | title + options list |
| `src/assets/images/products/<m>-drawing.png` | dimension drawing, 1x, for the product page |

## Planned double-blind process

1. **Pass A** and **pass B**: two agents independently transcribe every table from
   `table@3x.png` (seeing only the crops, not each other's output, not any prior data).
2. **Diff**: compare A and B cell by cell. Agreeing cells are accepted.
3. **Third look**: every disagreeing cell is resolved by a third reader using the
   `table-rows-<n>@5x.png` strips, with the row/column identified explicitly.
4. **TODO**: cells still unreadable or ambiguous after the third look are flagged
   `TODO(client)` and sent to the client for confirmation; never guessed.

Cross-checks for the diff step: each row's inch and mm columns (1 in = 25.4 mm) agree, and
`EST wt Lbs` ~ `EST wt Kgs` x 2.2046.

## Crop boxes (source pixels: left, top, right, bottom)

| Model | Source file | Source size | table | header_bottom / table_bottom / data rows | options | drawing |
| --- | --- | --- | --- | --- | --- | --- |
| sea | PECO-SEA-.png | 1000x707 | 24,415,942,635 | 461 / 628 / 11 | 55,158,300,382 | 303,33,940,372 |
| se20 | PECO_SE20-.png | 1000x670 | 27,419,948,639 | 468 / 633 / 10 | 30,138,300,412 | 368,18,985,372 |
| se30 | PECO_SE30-.png | 1000x707 | 41,415,900,665 | 461 / 658 / 13 | 45,175,300,410 | 348,38,940,372 |
| se40 | PECO_SE40-.png | 1000x707 | 41,411,910,661 | 442 / 655 / 14 | 45,175,330,405 | 342,38,948,372 |
| se50 | PECO_SE50-.png | 1000x707 | 41,401,900,665 | 446 / 659 / 14 | 45,158,330,382 | 336,28,930,356 |
| sls | PECO_SLS-.png | 1000x707 | 10,324,966,645 | 350 / 639 / 19 | 45,125,315,322 | 320,0,962,294 |
| sa1 | Peco_SA1_SPARK_ARRESTOR.png | 800x565 | 18,326,768,530 | 350 / 523 / 14 | 48,133,302,322 | 316,30,770,292 |

## Legibility notes

- SA1 is only 800x565, so its table text is about 20% smaller than the others; upscaling adds
  no detail. Light-grey (non-bold) mm and kg figures are soft at 5x and are the most likely
  place for A/B disagreement. SA1 header cells ("EST wt Lbs", "Part No") are also tight.
- The mm columns and EST wt Kgs are rendered in light grey on all sheets (lower contrast
  than the bold inch values).
- Some source quirks to transcribe as-is, not "fix": inconsistent part-number spacing
  (`SE206` vs `SE 204`, `SLS101` vs `SE 402 S`), `*` markers in the E Bore column, and
  `*` placeholder cells on SEA and SLS.
