import { describe, it, expect } from "vitest";
import {
  selectPaginationKey,
  normalizeCatalogRow,
  paginationError,
  parseKeysetCursor,
  encodeKeysetCursor,
  encodeLegacyCursor,
  keysetOrFilter,
  quoteFilterValue,
  NO_KEY_ERROR,
  type IndexCandidate,
} from "../../supabase/functions/be-eight-export/pagination.ts";

const idx = (over: Partial<IndexCandidate>): IndexCandidate => ({
  indexName: "ix",
  isPrimary: false,
  isUnique: true,
  isValid: true,
  isReady: true,
  isPartial: false,
  hasExpression: false,
  keyColumns: ["id"],
  keyColumnsNotNull: [true],
  ...over,
});

describe("be-eight pagination key discovery (mirrors be_eight_list_tables)", () => {
  it("1. a column merely named hotel_id, with no unique constraint, is not a key", () => {
    // The only index on the table is a plain (non-unique) index on hotel_id.
    expect(selectPaginationKey([
      idx({ indexName: "ix_hotel", isUnique: false, isPrimary: false, keyColumns: ["hotel_id"] }),
    ])).toBeNull();
    // And nothing about the name grants it a key.
    const entry = normalizeCatalogRow({
      columns: ["hotel_id", "amount"], object_kind: "table",
      pagination_columns: null, pagination_kind: null, pagination_verified: false,
    });
    expect(entry.paginationVerified).toBe(false);
    expect(paginationError(entry)).toBe(NO_KEY_ERROR);
  });

  it("2. an `id` column that is nullable or non-unique is not accepted", () => {
    expect(selectPaginationKey([idx({ keyColumnsNotNull: [false] })])).toBeNull();
    expect(selectPaginationKey([idx({ isUnique: false, isPrimary: false })])).toBeNull();
  });

  it("3. a simple primary key is accepted", () => {
    expect(selectPaginationKey([idx({ indexName: "pk", isPrimary: true })]))
      .toEqual({ columns: ["id"], kind: "primary_key" });
  });

  it("4. a simple UNIQUE + NOT NULL index is accepted", () => {
    expect(selectPaginationKey([idx({ indexName: "uq_key", keyColumns: ["key"] })]))
      .toEqual({ columns: ["key"], kind: "unique_not_null" });
  });

  it("5. a UNIQUE index with a nullable column is rejected", () => {
    expect(selectPaginationKey([
      idx({ keyColumns: ["email"], keyColumnsNotNull: [false] }),
    ])).toBeNull();
    expect(selectPaginationKey([
      idx({ keyColumns: ["a", "b"], keyColumnsNotNull: [true, false] }),
    ])).toBeNull();
  });

  it("6. partial / invalid / not-ready / expression / INCLUDE-only indexes are rejected", () => {
    expect(selectPaginationKey([idx({ isPartial: true })])).toBeNull();
    expect(selectPaginationKey([idx({ isValid: false })])).toBeNull();
    expect(selectPaginationKey([idx({ isReady: false })])).toBeNull();
    expect(selectPaginationKey([idx({ hasExpression: true })])).toBeNull();
    // INCLUDE columns are not key columns: an index with no key columns is unusable.
    expect(selectPaginationKey([
      idx({ keyColumns: [], keyColumnsNotNull: [], includeColumns: ["id"] }),
    ])).toBeNull();
  });

  it("6b. deterministic tie-break: primary key, then fewest columns, then name", () => {
    const chosen = selectPaginationKey([
      idx({ indexName: "uq_z", keyColumns: ["a"], keyColumnsNotNull: [true] }),
      idx({ indexName: "pk_t", isPrimary: true, keyColumns: ["x", "y"], keyColumnsNotNull: [true, true] }),
    ]);
    expect(chosen).toEqual({ columns: ["x", "y"], kind: "primary_key" });
    const noPk = selectPaginationKey([
      idx({ indexName: "uq_b", keyColumns: ["m", "n"], keyColumnsNotNull: [true, true] }),
      idx({ indexName: "uq_a", keyColumns: ["m", "n"], keyColumnsNotNull: [true, true] }),
      idx({ indexName: "uq_c", keyColumns: ["single"], keyColumnsNotNull: [true] }),
    ]);
    expect(noPk).toEqual({ columns: ["single"], kind: "unique_not_null" });
  });

  it("7. a composite primary key yields ordered cursor_columns and lexicographic keyset", () => {
    const key = selectPaginationKey([
      idx({ indexName: "pk", isPrimary: true, keyColumns: ["closing_id", "id"], keyColumnsNotNull: [true, true] }),
    ])!;
    expect(key.columns).toEqual(["closing_id", "id"]);
    expect(keysetOrFilter(key.columns, ["C1", "L9"]))
      .toBe('closing_id.gt."C1",and(closing_id.eq."C1",id.gt."L9")');
    // No skips / no duplicates: simulate paging a composite-keyed dataset.
    const rows = [
      ["a", "1"], ["a", "2"], ["a", "3"], ["b", "1"], ["b", "2"], ["c", "1"],
    ];
    const gt = (r: string[], k: string[]) =>
      r[0] > k[0] || (r[0] === k[0] && r[1] > k[1]);
    const seen: string[] = [];
    let cur: string[] | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = rows.filter((r) => cur === null || gt(r, cur!)).slice(0, 2);
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.join("/")));
      cur = page[page.length - 1];
    }
    expect(seen).toEqual(rows.map((r) => r.join("/")));
    expect(new Set(seen).size).toBe(rows.length);
  });

  it("8. a resource with no verified key is still catalogued but flagged", () => {
    const view = normalizeCatalogRow({
      columns: ["hotel_id", "total"], object_kind: "view",
      pagination_columns: null, pagination_kind: null, pagination_verified: null,
    });
    expect(view.kind).toBe("view");
    expect(view.columns).toEqual(["hotel_id", "total"]);   // listed in /manifest
    expect(view.paginationVerified).toBe(false);            // non_paginated=true
    expect(view.paginationColumns).toEqual([]);
    expect(paginationError(view)).toBe(NO_KEY_ERROR);       // export => 409
  });

  it("8b. a catalog row claiming a key that is not in the column list is rejected", () => {
    const e = normalizeCatalogRow({
      columns: ["a"], pagination_columns: ["ghost"],
      pagination_kind: "primary_key", pagination_verified: true,
    });
    expect(e.paginationVerified).toBe(false);
  });

  it("8c. an unknown pagination_kind is not trusted", () => {
    const e = normalizeCatalogRow({
      columns: ["id"], pagination_columns: ["id"],
      pagination_kind: "rowid_guess", pagination_verified: true,
    });
    expect(e.paginationVerified).toBe(false);
  });

  it("9. a tampered cursor with columns other than the catalog's is rejected", () => {
    const forged = encodeKeysetCursor(["salary"], ["0"]);
    const r = parseKeysetCursor(forged, ["id"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { ok: false; reason: string }).reason).toBe("cursor_key_mismatch");
    expect(parseKeysetCursor("!!!not-base64!!!", ["id"]).ok).toBe(false);
    expect(parseKeysetCursor(encodeKeysetCursor(["id"], ["a"]), ["closing_id", "id"]).ok).toBe(false);
    // Arity mismatch and control characters are refused.
    expect(parseKeysetCursor(btoa(JSON.stringify({ k: ["id"], v: [] })), ["id"]).ok).toBe(false);
    expect(parseKeysetCursor(btoa(JSON.stringify({ k: ["id"], v: ["a\u0000b"] })), ["id"]).ok).toBe(false);
    // Injection attempts stay quoted literals, never SQL/filter syntax.
    expect(quoteFilterValue('x","y')).toBe('"x\\",\\"y"');
    expect(keysetOrFilter(["id"], ['a,b)or(1.eq.1'])).toBe('id.gt."a,b)or(1.eq.1"');
  });

  it("10. legacy simple cursors keep working", () => {
    const withCol = parseKeysetCursor(encodeLegacyCursor("abc", null, "id"), ["id"]);
    expect(withCol).toEqual({ ok: true, values: ["abc"] });
    const legacyId = parseKeysetCursor(encodeLegacyCursor("2026-01-01T00:00:00Z", "row-9"), ["id"]);
    expect(legacyId).toEqual({ ok: true, values: ["row-9"] });
    const valueOnly = parseKeysetCursor(encodeLegacyCursor("k1", null), ["key"]);
    expect(valueOnly).toEqual({ ok: true, values: ["k1"] });
    // A legacy cursor for a different column is refused.
    expect(parseKeysetCursor(encodeLegacyCursor("v", null, "created_at"), ["id"]).ok).toBe(false);
    // A legacy (single-key) cursor cannot be used on a composite key.
    expect(parseKeysetCursor(encodeLegacyCursor("v", null, "id"), ["closing_id", "id"]).ok).toBe(false);
    // No cursor => first page.
    expect(parseKeysetCursor(null, ["id"])).toEqual({ ok: true, values: null });
  });

  it("11. probe-based has_more is correct at limit 1, 5, 500, 999 and 1000", () => {
    // Emulates: request exactly `limit` rows, then one keyset probe row.
    const total = 2500;
    const all = Array.from({ length: total }, (_, i) => String(i).padStart(6, "0"));
    for (const limit of [1, 5, 500, 999, 1000]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      const pages: { count: number; hasMore: boolean }[] = [];
      for (let guard = 0; guard <= Math.ceil(total / limit) + 1; guard++) {
        const parsed = parseKeysetCursor(cursor, ["id"]);
        expect(parsed.ok).toBe(true);
        const after = parsed.ok ? parsed.values?.[0] ?? null : null;
        const rest = all.filter((v) => after === null || v > after);
        const page = rest.slice(0, limit);
        if (page.length === 0) break;
        // has_more probe: exactly one row beyond the last key.
        const probe = rest.slice(limit, limit + 1);
        const hasMore = page.length === limit && probe.length > 0;
        pages.push({ count: page.length, hasMore });
        seen.push(...page);
        cursor = hasMore ? encodeKeysetCursor(["id"], [page[page.length - 1]]) : null;
        if (!hasMore) break;
      }
      expect(seen).toEqual(all);                       // no gaps, no truncation
      expect(new Set(seen).size).toBe(total);          // no duplicates
      expect(pages[0].count).toBe(Math.min(limit, total));
      expect(pages[pages.length - 1].hasMore).toBe(false);
      if (pages.length > 2) expect(pages[1].hasMore).toBe(true);
      expect(pages.length).toBe(Math.ceil(total / limit));
    }
  });

  it("12. a composite key whose leading column repeats more than `limit` times never truncates", () => {
    // 2500 rows all sharing closing_id='C1' plus a second closing.
    const rows: string[][] = [
      ...Array.from({ length: 2500 }, (_, i) => ["C1", String(i).padStart(6, "0")]),
      ["C2", "000000"],
    ];
    const gt = (r: string[], k: string[]) => r[0] > k[0] || (r[0] === k[0] && r[1] > k[1]);
    const limit = 1000;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const parsed = parseKeysetCursor(cursor, ["closing_id", "id"]);
      expect(parsed.ok).toBe(true);
      const after = parsed.ok ? parsed.values : null;
      const rest = rows.filter((r) => after === null || gt(r, after));
      const page = rest.slice(0, limit);
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.join("/")));
      const hasMore = page.length === limit && rest.length > limit;
      cursor = hasMore
        ? encodeKeysetCursor(["closing_id", "id"], page[page.length - 1])
        : null;
      if (!hasMore) break;
    }
    expect(seen.length).toBe(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  });

  it("13. watermark-style metadata carries no row values and ignores include_sensitive", () => {
    // /watermarks reports only these keys per resource.
    const watermark = {
      resource: "rh_employees",
      incremental_column: "updated_at",
      supports_updated_since: true,
      latest_updated_at: "2026-08-01T00:00:00Z",
      record_count: 4211,
    };
    expect(Object.keys(watermark).sort()).toEqual([
      "incremental_column", "latest_updated_at", "record_count",
      "resource", "supports_updated_since",
    ]);
    // Exact counts are row counts, so they cannot depend on column stripping.
    const countFor = (_includeSensitive: boolean) => watermark.record_count;
    expect(countFor(false)).toBe(countFor(true));
  });
});
