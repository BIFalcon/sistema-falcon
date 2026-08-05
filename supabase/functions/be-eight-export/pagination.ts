// Provable keyset pagination for the Be Eight export.
//
// The pagination key is NEVER guessed from a column name. It comes exclusively
// from `public.be_eight_list_tables()`, which derives it from pg_catalog:
// PRIMARY KEY first, then a valid / ready / non-partial / expression-free
// UNIQUE index whose leading key columns (INCLUDE columns excluded) are all
// NOT NULL. `selectPaginationKey` below is the executable reference of that
// rule set and is kept in sync with the SQL (it is the spec the tests pin).

export type PaginationKind = "primary_key" | "unique_not_null";

/** Index candidate as described by pg_catalog. */
export interface IndexCandidate {
  indexName: string;
  isPrimary: boolean;
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  isPartial: boolean;
  hasExpression: boolean;
  /** Leading key columns only (pg_index.indnkeyatts), in index order. */
  keyColumns: string[];
  /** INCLUDE columns — never usable for ordering. */
  includeColumns?: string[];
  /** attnotnull per key column, same order as keyColumns. */
  keyColumnsNotNull: boolean[];
}

export interface SelectedKey {
  columns: string[];
  kind: PaginationKind;
}

/**
 * Deterministic choice: primary key first, then fewest columns, then index name.
 * Returns null when nothing is provable — callers must fail closed.
 */
export function selectPaginationKey(candidates: IndexCandidate[]): SelectedKey | null {
  const usable = candidates.filter((c) =>
    (c.isPrimary || c.isUnique) &&
    c.isValid && c.isReady &&
    !c.isPartial && !c.hasExpression &&
    c.keyColumns.length > 0 &&
    c.keyColumns.length === c.keyColumnsNotNull.length &&
    c.keyColumnsNotNull.every(Boolean)
  );
  if (usable.length === 0) return null;
  usable.sort((a, b) =>
    (Number(b.isPrimary) - Number(a.isPrimary)) ||
    (a.keyColumns.length - b.keyColumns.length) ||
    a.indexName.localeCompare(b.indexName)
  );
  const best = usable[0];
  return {
    columns: [...best.keyColumns],
    kind: best.isPrimary ? "primary_key" : "unique_not_null",
  };
}

// --------------------------------------------------------------------------
// Catalog entries
// --------------------------------------------------------------------------

export interface CatalogEntry {
  columns: string[];
  kind: string;
  paginationColumns: string[];
  paginationKind: PaginationKind | null;
  paginationVerified: boolean;
}

export const NO_KEY_ERROR = "no_stable_pagination_key";

/** Normalize one `be_eight_list_tables()` row, fail-closed on anything odd. */
export function normalizeCatalogRow(row: {
  columns?: string[] | null;
  object_kind?: string | null;
  pagination_columns?: string[] | null;
  pagination_kind?: string | null;
  pagination_verified?: boolean | null;
}): CatalogEntry {
  const columns = row.columns ?? [];
  const keyCols = row.pagination_columns ?? [];
  const kind = row.pagination_kind === "primary_key" || row.pagination_kind === "unique_not_null"
    ? row.pagination_kind
    : null;
  // The key must be verified by the catalog AND every key column must still be
  // part of the exposed column list. Anything else => not paginable.
  const verified = row.pagination_verified === true &&
    kind !== null &&
    keyCols.length > 0 &&
    keyCols.every((c) => columns.includes(c));
  return {
    columns,
    kind: row.object_kind ?? "table",
    paginationColumns: verified ? keyCols : [],
    paginationKind: verified ? kind : null,
    paginationVerified: verified,
  };
}

export function paginationError(entry: CatalogEntry): string | null {
  return entry.paginationVerified ? null : NO_KEY_ERROR;
}

// --------------------------------------------------------------------------
// Cursors
// --------------------------------------------------------------------------

const MAX_CURSOR_VALUE_LEN = 256;

/**
 * Cursor payload: `{ k: [colNames], v: [values] }`, base64. Column names are
 * echoed only so a stale cursor can be detected — the SQL identifiers used in
 * the query always come from the internal catalog, never from the cursor.
 */
export function encodeKeysetCursor(columns: string[], values: unknown[]): string {
  return btoa(JSON.stringify({ k: columns, v: values.map((v) => String(v)) }));
}

/** Legacy single-key cursor shape kept for the transition. */
export function encodeLegacyCursor(value: unknown, id: string | null, col?: string): string {
  return btoa(JSON.stringify(col ? { v: value, id, c: col } : { v: value, id }));
}

export type CursorResult =
  | { ok: true; values: string[] | null }
  | { ok: false; reason: string };

function safeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
  const s = String(v);
  if (s.length === 0 || s.length > MAX_CURSOR_VALUE_LEN) return null;
  // No control characters; anything else is quoted for PostgREST.
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/**
 * Parse a cursor against the catalog-verified key columns. Rejects any cursor
 * whose columns differ from the catalog (tampered or stale schema).
 */
export function parseKeysetCursor(
  cursor: string | null,
  expectedColumns: string[],
): CursorResult {
  if (!cursor) return { ok: true, values: null };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(atob(cursor)) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return { ok: false, reason: "invalid_cursor" };
  } catch {
    return { ok: false, reason: "invalid_cursor" };
  }

  // New composite/simple form.
  if (Array.isArray(obj.k) || Array.isArray(obj.v)) {
    const k = Array.isArray(obj.k) ? obj.k.map((x) => String(x)) : null;
    const raw = Array.isArray(obj.v) ? obj.v : null;
    if (!k || !raw) return { ok: false, reason: "invalid_cursor" };
    if (k.length !== expectedColumns.length || k.some((c, i) => c !== expectedColumns[i])) {
      return { ok: false, reason: "cursor_key_mismatch" };
    }
    if (raw.length !== expectedColumns.length) return { ok: false, reason: "invalid_cursor" };
    const values: string[] = [];
    for (const v of raw) {
      const s = safeValue(v);
      if (s === null) return { ok: false, reason: "invalid_cursor" };
      values.push(s);
    }
    return { ok: true, values };
  }

  // Legacy single-key cursors: { v, id, c? }.
  if (expectedColumns.length !== 1) return { ok: false, reason: "cursor_key_mismatch" };
  const col = expectedColumns[0];
  const legacyCol = obj.c === undefined || obj.c === null ? null : String(obj.c);
  let candidate: unknown = null;
  if (legacyCol !== null) {
    if (legacyCol !== col) return { ok: false, reason: "cursor_key_mismatch" };
    candidate = obj.v;
  } else if (col === "id" && obj.id != null) {
    candidate = obj.id;
  } else if (obj.v != null && obj.id == null) {
    candidate = obj.v;
  }
  const s = safeValue(candidate);
  if (s === null) return { ok: false, reason: "invalid_cursor" };
  return { ok: true, values: [s] };
}

// --------------------------------------------------------------------------
// PostgREST keyset predicate
// --------------------------------------------------------------------------

/** Quote a literal for a PostgREST filter so separators can't break out. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Lexicographic "strictly greater than" predicate over the key tuple, in the
 * PostgREST `or=` syntax. Column names come from the internal catalog only.
 *   (a) > (A)            -> a.gt."A"
 *   (a,b) > (A,B)        -> a.gt."A",and(a.eq."A",b.gt."B")
 */
export function keysetOrFilter(columns: string[], values: string[]): string {
  if (columns.length !== values.length || columns.length === 0) {
    throw new Error("keyset_arity_mismatch");
  }
  const terms: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const eqs = columns.slice(0, i).map((c, j) => `${c}.eq.${quoteFilterValue(values[j])}`);
    const gt = `${columns[i]}.gt.${quoteFilterValue(values[i])}`;
    terms.push(eqs.length === 0 ? gt : `and(${eqs.join(",")},${gt})`);
  }
  return terms.join(",");
}
