/*
 * Size-table CSV loader (src/content/sizes/<slug>.csv).
 *
 * Encoding
 * - Header: partNo,fig,markers,bore_in,bore_mm, then per product column (from the
 *   product JSON `columns`, in order):
 *     pair  -> <key>_in,<key>_mm
 *     holes -> <key>_count,<key>_dia,<key>_mm   ("4X11/16" + 17  ->  4,11/16,17)
 *     bolt  -> <key>_size,<key>_mm              ("3/8"" + 10     ->  3/8,10)
 *   then wt_lbs,wt_kg,note. The header must match exactly or loading fails.
 * - Inch cells (_in, _dia, _size) are stored as printed but WITHOUT the " symbol:
 *   "1 1/2", "3/4", "1.25", "10". SpecTable adds the unit.
 * - "*"    = asterisk printed on the datasheet (meaning unknown; TODO(client)) -> {kind:"na"}.
 * - "TODO" = cell not read or not transcribed yet; give the reason in `note`   -> {kind:"todo"}.
 * - raw2: some datasheets print a second inch value in decimal instead of mm in a pair
 *   (SEA column G, small bores: 3/4" | 0.75). Encode the mm cell as `raw2:0.75`. It is
 *   stored as {kind:"pair", in:"3/4", mm:null, raw2:"0.75"} and rendered as printed.
 *   `raw2:` is only accepted in pair _mm cells.
 * - fig: datasheet figure number ("1", "2") or empty. markers: bore marker as printed
 *   ("S", "*") or empty; this "*" is a literal marker, not an n/a cell.
 * - note: free text. check-products.mjs requires it on any row that fails a sanity check.
 * - Fields containing a comma or quote are double-quoted, quotes doubled (RFC 4180).
 * - A UTF-8 BOM is stripped. Any invalid cell throws an Error naming line, column and value,
 *   so an Excel-mangled file (e.g. "3/4" turned into "03-Apr") fails the build.
 */

export type ColumnKind = "pair" | "holes" | "bolt";

export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
}

export type Na = { kind: "na" };
export type Todo = { kind: "todo" };
export type PairCell =
  { kind: "pair"; in: string; mm: number | null; raw2?: string } | Na | Todo;
export type HolesCell =
  { kind: "holes"; count: number; dia: string; mm: number | null } | Na | Todo;
export type BoltCell =
  { kind: "bolt"; size: string; mm: number | null } | Na | Todo;
export type NumCell = { kind: "num"; value: number } | Na | Todo;
export type DimCell = PairCell | HolesCell | BoltCell;

export interface SizeRow {
  partNo: string;
  fig: string | null;
  markers: string;
  bore: PairCell;
  dims: Record<string, DimCell>;
  wt: { lbs: NumCell; kg: NumCell };
  note: string;
}

export const INCH_RE =
  /^\d+(\s\d+\/\d+)?$|^\d+\/\d+$|^\d+(\.\d+)?$|^\*$|^TODO$/;
export const NUM_RE = /^\d+(\.\d+)?$|^\*$|^TODO$/;
const RAW2_RE = /^raw2:(\d+(\.\d+)?)$/;
const MARKERS_RE = /^[A-Za-z*]*$/;
const FIG_RE = /^\d*$/;

/** Parse RFC 4180-style CSV. Returns records with the 1-based line each starts on. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(quotedField ? field : field.trim());
    field = "";
    quotedField = false;
  };
  const endRecord = () => {
    endField();
    if (!(fields.length === 1 && fields[0] === ""))
      records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim() !== "") {
        throw new Error(
          `CSV line ${line}: unexpected quote inside an unquoted field`,
        );
      }
      field = "";
      inQuotes = true;
      quotedField = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes)
    throw new Error(`CSV line ${recordLine}: unterminated quoted field`);
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}

/** The exact header a product's size CSV must have. */
export function expectedHeader(columns: readonly Column[]): string[] {
  const header = ["partNo", "fig", "markers", "bore_in", "bore_mm"];
  for (const c of columns) {
    if (c.kind === "pair") header.push(`${c.key}_in`, `${c.key}_mm`);
    else if (c.kind === "holes")
      header.push(`${c.key}_count`, `${c.key}_dia`, `${c.key}_mm`);
    else header.push(`${c.key}_size`, `${c.key}_mm`);
  }
  header.push("wt_lbs", "wt_kg", "note");
  return header;
}

/** Parse and validate a size-table CSV against the product's column definitions. Throws on any problem. */
export function loadSizesCsv(
  text: string,
  columns: readonly Column[],
  source = "sizes CSV",
): SizeRow[] {
  const expected = expectedHeader(columns);
  const keys = new Set<string>();
  for (const c of columns) {
    if (
      !/^[A-Za-z][A-Za-z0-9]*$/.test(c.key) ||
      c.key === "bore" ||
      c.key === "wt"
    ) {
      throw new Error(
        `${source}: invalid column key "${c.key}" (letters and digits only; not "bore" or "wt")`,
      );
    }
    if (keys.has(c.key))
      throw new Error(`${source}: duplicate column key "${c.key}"`);
    keys.add(c.key);
  }

  const records = parseCsv(text);
  if (records.length === 0) throw new Error(`${source}: file is empty`);
  const [head, ...body] = records;
  if (head.fields.join(",") !== expected.join(",")) {
    throw new Error(
      `${source}: header mismatch\n  expected: ${expected.join(",")}\n  actual:   ${head.fields.join(",")}`,
    );
  }
  if (body.length === 0) throw new Error(`${source}: no data rows`);

  return body.map(({ line, fields }) => {
    if (fields.length !== expected.length) {
      throw new Error(
        `${source} line ${line}: expected ${expected.length} fields, found ${fields.length}`,
      );
    }
    const cell: Record<string, string> = {};
    expected.forEach((name, i) => (cell[name] = fields[i]));

    const fail = (col: string, why: string): never => {
      throw new Error(
        `${source} line ${line} (${cell.partNo || "no partNo"}), column ${col}: invalid value "${cell[col]}" (${why})`,
      );
    };
    const inch = (col: string) => {
      if (!INCH_RE.test(cell[col]))
        fail(col, 'expected inches like 1, 1.25, 3/4, 1 1/2, "*" or TODO');
      return cell[col];
    };
    const num = (col: string) => {
      if (!NUM_RE.test(cell[col])) fail(col, 'expected a number, "*" or TODO');
      return cell[col];
    };
    // Shared rule: primary (inch/count) values decide the cell kind; a numeric mm
    // alongside a "*" or TODO primary is contradictory and rejected.
    const status = (
      cols: string[],
      values: string[],
    ): "value" | "na" | "todo" => {
      if (values.every((v) => v === "*")) return "na";
      if (values.some((v) => v === "TODO")) return "todo";
      const bad = values.findIndex((v) => v === "*");
      if (bad >= 0) fail(cols[bad], 'mixes "*" with values in the same cell');
      return "value";
    };
    const mmOf = (
      col: string,
      primary: "value" | "na" | "todo",
    ): number | null => {
      const v = num(col);
      if (primary !== "value" && v !== "*" && v !== "TODO")
        fail(col, "mm given but the inch value is * or TODO");
      return v === "*" || v === "TODO" ? null : Number(v);
    };

    const pair = (key: string): PairCell => {
      const inCol = `${key}_in`;
      const mmCol = `${key}_mm`;
      const inV = inch(inCol);
      const raw2 = RAW2_RE.exec(cell[mmCol]);
      const st = status([inCol], [inV]);
      if (raw2) {
        if (st !== "value")
          fail(mmCol, "raw2 given but the inch value is * or TODO");
        return { kind: "pair", in: inV, mm: null, raw2: raw2[1] };
      }
      if (st === "na" && cell[mmCol] === "TODO") return { kind: "todo" };
      const mm = mmOf(mmCol, st);
      if (st !== "value") return { kind: st };
      return { kind: "pair", in: inV, mm };
    };
    const holes = (key: string): HolesCell => {
      const cols = [`${key}_count`, `${key}_dia`];
      const count = num(cols[0]);
      const dia = inch(cols[1]);
      if (count !== "*" && count !== "TODO" && !/^\d+$/.test(count))
        fail(cols[0], "hole count must be a whole number");
      const st = status(cols, [count, dia]);
      const mm = mmOf(`${key}_mm`, st);
      if (st !== "value") return { kind: st };
      return { kind: "holes", count: Number(count), dia, mm };
    };
    const bolt = (key: string): BoltCell => {
      const col = `${key}_size`;
      const size = inch(col);
      const st = status([col], [size]);
      const mm = mmOf(`${key}_mm`, st);
      if (st !== "value") return { kind: st };
      return { kind: "bolt", size, mm };
    };
    const scalar = (col: string): NumCell => {
      const v = num(col);
      if (v === "*") return { kind: "na" };
      if (v === "TODO") return { kind: "todo" };
      return { kind: "num", value: Number(v) };
    };

    if (cell.partNo === "") fail("partNo", "part number is required");
    if (!FIG_RE.test(cell.fig))
      fail("fig", "expected a figure number or empty");
    if (!MARKERS_RE.test(cell.markers))
      fail("markers", 'expected letters and/or "*" or empty');

    const dims: Record<string, DimCell> = {};
    for (const c of columns) {
      dims[c.key] =
        c.kind === "pair"
          ? pair(c.key)
          : c.kind === "holes"
            ? holes(c.key)
            : bolt(c.key);
    }

    return {
      partNo: cell.partNo,
      fig: cell.fig === "" ? null : cell.fig,
      markers: cell.markers,
      bore: pair("bore"),
      dims,
      wt: { lbs: scalar("wt_lbs"), kg: scalar("wt_kg") },
      note: cell.note,
    };
  });
}
