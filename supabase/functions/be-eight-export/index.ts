// Be Eight read-only export API for Falcon Hoteis.
//
// Auth (server-to-server only, no end-user session):
//   - Preferred: ES256 JWT signed by Be Eight (JWKS in BE_EIGHT_EXPORT_JWKS_JSON).
//   - Temporary: legacy static bearer tokens, gated by
//     BE_EIGHT_EXPORT_ALLOW_LEGACY_TOKEN (enabled in this delivery so the
//     production cron keeps working). The security finding is only fully
//     resolved once legacy mode is turned OFF.
//
// Only SELECT operations. Returns JSON. Paginated, max 1000 rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  authenticate,
  checkRateLimit,
  rateLimitMax,
  sha256Hex,
  SCOPE_SENSITIVE,
  type AuthMode,
} from "./auth.ts";
import {
  blockedColumns,
  classifyColumn,
  isBusinessSensitiveColumn,
  stripRow,
  TABLE_DENYLIST,
  visibleColumns,
} from "./catalog.ts";

const SCHEMA_VERSION = "falcon-lovable-export-v3";
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Table denylist, column classification and row stripping live in catalog.ts.
// Derived resources exposed via /export?resource=...
const DERIVED_RESOURCES = [
  "dre_latest_lines",
  "dre_latest_indicators",
  "rh_summary",
  "table_counts",
  "latest_updates",
];

// Candidate columns used to choose cursor / incremental column, in priority
// order. `updated_at` is preferred when present; otherwise we fall back to
// append-only timestamps. Every public business table now has at least one of
// these columns (a migration backfilled `created_at` on the few that didn't).
const INCREMENTAL_CANDIDATES = [
  "updated_at",
  "changed_at",
  "uploaded_at",
  "sent_at",
  "received_at",
  "created_at",
  // Conditional event timestamps (may be NULL on unaffected rows). Used only
  // when no row-level creation/update timestamp exists.
  "unsubscribed_at",
  "suppressed_at",
  "approved_at",
  "paid_at",
];
const CURSOR_CANDIDATES = [...INCREMENTAL_CANDIDATES, "id"];

// Columns that are safe to paginate on: unique (or effectively unique) and
// NOT NULL, so a keyset cursor can never skip or repeat a row and can never
// hit a NULL boundary. Timestamp columns are deliberately NOT used as cursor
// keys: they are nullable and non-unique, which silently loses rows.
// Discovered dynamically per table — no manual per-table allowlist.
const PAGINATION_KEY_CANDIDATES = [
  "id",
  "key",
  "jti_hash",
  "email",
  "table_name",
  "hotel_id",
  "user_id",
];

function pickPaginationKey(cols: string[]): string | null {
  for (const c of PAGINATION_KEY_CANDIDATES) {
    if (cols.includes(c)) return c;
  }
  return null;
}

interface RequestContext {
  requestId: string;
  supabase: ReturnType<typeof createClient>;
  scope: "standard" | "privileged";
  includeSensitive: boolean;
  discovery?: Promise<Map<string, { columns: string[]; kind: string }>>;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function json(body: unknown, status = 200, requestId?: string) {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "x-schema-version": SCHEMA_VERSION,
  };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  status: number,
  errorCode: string,
  message: string,
  requestId: string,
) {
  return json(
    { error_code: errorCode, message, request_id: requestId, schema_version: SCHEMA_VERSION },
    status,
    requestId,
  );
}

function stripSensitive<T extends Record<string, unknown>>(
  table: string,
  row: T,
  includeSensitive: boolean,
): T {
  return stripRow(table, row, includeSensitive);
}

async function getTableColumns(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<string[]> {
  // Fetch a 1-row sample to introspect columns. Schema introspection via
  // information_schema is not exposed via PostgREST by default.
  const { data, error } = await supabase.from(table).select("*").limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  return Object.keys(data[0] as Record<string, unknown>);
}

// Discover all exportable public-schema base tables AND views via a
// service_role-only RPC. Only TABLE_DENYLIST entries (technical/security
// artifacts) are filtered out, so new business tables/columns are picked up
// automatically. Cached per request via ctx.discovery.
async function discoverTables(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, { columns: string[]; kind: string }>> {
  const { data, error } = await supabase.rpc("be_eight_list_tables");
  if (error) throw new Error("discovery_failed");
  const map = new Map<string, { columns: string[]; kind: string }>();
  for (const row of (data ?? []) as Array<{ table_name: string; columns: string[]; object_kind?: string }>) {
    if (TABLE_DENYLIST.has(row.table_name)) continue;
    map.set(row.table_name, { columns: row.columns ?? [], kind: row.object_kind ?? "table" });
  }
  return map;
}

async function getDiscovery(
  ctx: RequestContext,
): Promise<Map<string, { columns: string[]; kind: string }>> {
  if (!ctx.discovery) ctx.discovery = discoverTables(ctx.supabase);
  return await ctx.discovery;
}

async function pickColumn(
  supabase: ReturnType<typeof createClient>,
  table: string,
  candidates: string[],
): Promise<string | null> {
  const cols = await getTableColumns(supabase, table);
  for (const c of candidates) {
    if (cols.includes(c)) return c;
  }
  return null;
}

function parseCursor(
  cursor: string | null,
): { value: unknown; id: string | null; col: string | null } | null {
  if (!cursor) return null;
  try {
    const decoded = atob(cursor);
    const obj = JSON.parse(decoded);
    return { value: obj.v ?? null, id: obj.id ?? null, col: obj.c ?? null };
  } catch {
    return null;
  }
}

function encodeCursor(value: unknown, id: string | null, col?: string): string {
  return btoa(JSON.stringify(col ? { v: value, id, c: col } : { v: value, id }));
}

async function exportTable(
  ctx: RequestContext,
  table: string,
  url: URL,
): Promise<Response> {
  let discovered: Map<string, { columns: string[]; kind: string }>;
  try {
    discovered = await getDiscovery(ctx);
  } catch {
    return errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId);
  }
  // Never interpolate a caller-supplied identifier into SQL, and never touch a
  // name that is not part of the internally computed catalog.
  if (!discovered.has(table)) {
    return errorResponse(404, "resource_not_found", "Unknown resource", ctx.requestId);
  }
  table = [...discovered.keys()].find((t) => t === table)!;

  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const cursorParam = url.searchParams.get("cursor");
  const updatedSince = url.searchParams.get("updated_since");
  const uploadedSince = url.searchParams.get("uploaded_since");
  const hotelId = url.searchParams.get("hotel_id");
  const closingId = url.searchParams.get("closing_id");
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");

  // Prefer the authoritative column list from pg_catalog so that empty
  // tables also work. Fall back to a 1-row sample if discovery is empty.
  let cols: string[] = discovered.get(table)?.columns ?? [];
  if (cols.length === 0) {
    try {
      cols = await getTableColumns(ctx.supabase, table);
    } catch {
      return errorResponse(500, "introspection_failed", "Introspection failed", ctx.requestId);
    }
  }

  const hasCol = (c: string) => cols.includes(c);

  // Determine the pagination key: must be unique and NOT NULL so keyset
  // pagination can neither skip nor duplicate rows. If a table has no safe
  // key we fail explicitly instead of silently losing rows.
  const cursorCol = pickPaginationKey(cols);
  if (!cursorCol) {
    return errorResponse(
      409,
      "pagination_unavailable",
      "Resource has no stable pagination key; see manifest.non_paginated",
      ctx.requestId,
    );
  }

  // Incremental column.
  let incrementalCol: string | null = null;
  for (const c of INCREMENTAL_CANDIDATES) {
    if (hasCol(c)) { incrementalCol = c; break; }
  }

  const buildQuery = (after: string | null, pageSize: number) => {
    let q = ctx.supabase
      .from(table)
      .select("*")
      .order(cursorCol, { ascending: true })
      .limit(pageSize);
    if (hotelId && hasCol("hotel_id")) q = q.eq("hotel_id", hotelId);
    if (closingId && hasCol("closing_id")) q = q.eq("closing_id", closingId);
    if (year && hasCol("year")) q = q.eq("year", Number(year));
    if (month && hasCol("month")) q = q.eq("month", Number(month));
    if (updatedSince && incrementalCol) q = q.gte(incrementalCol, updatedSince);
    if (uploadedSince && hasCol("uploaded_at")) q = q.gte("uploaded_at", uploadedSince);
    if (after !== null) q = q.gt(cursorCol, after as never);
    return q;
  };

  // Cursor pagination. Accept cursors issued for this key column; tolerate
  // legacy cursors that carried the row id alongside a timestamp value.
  const parsed = parseCursor(cursorParam);
  let after: string | null = null;
  if (parsed) {
    if (parsed.col === cursorCol && parsed.value != null) after = String(parsed.value);
    else if (cursorCol === "id" && parsed.id) after = String(parsed.id);
    else if (parsed.col === null && parsed.value != null && !parsed.id) after = String(parsed.value);
  }

  const { data, error } = await buildQuery(after, limit);
  if (error) {
    console.log(JSON.stringify({
      kind: "be_eight_export_query_error", request_id: ctx.requestId, resource: table,
    }));
    return errorResponse(500, "query_failed", "Query failed", ctx.requestId);
  }

  const rows = (data ?? []).map((r) =>
    stripSensitive(table, r as Record<string, unknown>, ctx.includeSensitive),
  );
  // has_more via a separate keyset probe (limit=1). Never request `limit + 1`:
  // PostgREST caps responses at 1000 rows, so with limit=1000 the sentinel row
  // would never arrive and pagination would stop silently.
  let nextCursor: string | null = null;
  if (data && data.length === limit) {
    const last = data[data.length - 1] as Record<string, unknown>;
    const lastKey = String(last[cursorCol]);
    const probe = await buildQuery(lastKey, 1);
    if (probe.error) {
      return errorResponse(500, "query_failed", "Query failed", ctx.requestId);
    }
    if ((probe.data ?? []).length > 0) {
      nextCursor = encodeCursor(lastKey, (last.id as string) ?? null, cursorCol);
    }
  }

  return json({
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    table,
    cursor_column: cursorCol,
    incremental_column: incrementalCol,
    limit,
    count: rows.length,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    scope: ctx.scope,
    include_sensitive: ctx.includeSensitive,
    rows,
  }, 200, ctx.requestId);
}

async function approxRowCount(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "estimated", head: true });
  if (error) return null;
  return count ?? null;
}

// Exact row count that mirrors the base export query for a table: same
// `from(table).select("*")` shape, no filters, no cursor, no `updated_since`.
// `include_sensitive` only controls which columns are stripped from row
// payloads — it never restricts rows — so the count is identical for both
// scopes. Used by /watermarks so callers can detect real source changes
// instead of tracking pg_class estimates that drift after every VACUUM.
async function exactRowCount(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return null;
  return count ?? null;
}

async function latestUpdatedAt(
  supabase: ReturnType<typeof createClient>,
  table: string,
  col: string | null,
): Promise<string | null> {
  if (!col) return null;
  const { data, error } = await supabase
    .from(table)
    .select(col)
    .order(col, { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const v = (data[0] as Record<string, unknown>)[col];
  return v == null ? null : String(v);
}

async function handleManifest(ctx: RequestContext): Promise<Response> {
  let discovered: Map<string, { columns: string[]; kind: string }>;
  try {
    discovered = await getDiscovery(ctx);
  } catch {
    return errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId);
  }
  const tableNames = Array.from(discovered.keys()).sort();
  const tables = [];
  for (const t of tableNames) {
    const entry = discovered.get(t);
    const cols: string[] = entry?.columns ?? [];
    const sensitive = cols.filter((c) => isBusinessSensitiveColumn(t, c));
    const secrets = cols.filter((c) => classifyColumn(t, c) === "technical_secret");
    const visible = visibleColumns(t, cols, ctx.includeSensitive);
    const cursorCol = pickPaginationKey(cols);
    const incrementalCol = INCREMENTAL_CANDIDATES.find((c) => cols.includes(c)) ?? null;
    const rowCount = await exactRowCount(ctx.supabase, t);
    const latest = await latestUpdatedAt(ctx.supabase, t, incrementalCol);
    // Metadata only: names of withheld columns are listed, values never are.
    const blocked = blockedColumns(t, cols, ctx.includeSensitive);
    tables.push({
      table: t,
      resource: t,
      object_kind: entry?.kind ?? "table",
      columns: visible,
      hidden_columns: blocked,
      blocked_columns: blocked,
      sensitive_columns: sensitive,
      technical_secret_columns: secrets,
      row_count: rowCount,
      record_count: rowCount,
      cursor_column: cursorCol,
      incremental_column: incrementalCol,
      latest_updated_at: latest,
      supports_cursor: cursorCol !== null,
      supports_updated_since: incrementalCol !== null,
      non_paginated: cursorCol === null,
      pagination_error: cursorCol === null ? "no_stable_pagination_key" : null,
      contains_sensitive: sensitive.length > 0,
      contains_sensitive_data: sensitive.length > 0,
    });
  }
  const derived = [
    { resource: "dre_latest_lines", cursor_column: "closing_id,id", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
    { resource: "dre_latest_indicators", cursor_column: "closing_id,id", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
    { resource: "rh_summary", cursor_column: "hotel_id", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
    { resource: "table_counts", cursor_column: "table", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
    { resource: "latest_updates", cursor_column: "table", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
  ];
  return json({
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    generated_at: new Date().toISOString(),
    scope: ctx.scope,
    include_sensitive: ctx.includeSensitive,
    denylist: Array.from(TABLE_DENYLIST).sort(),
    tables,
    derived_resources: DERIVED_RESOURCES,
    derived: derived,
  }, 200, ctx.requestId);
}

// Lightweight per-resource watermarks: only latest_updated_at and record_count.
// No row data, no sensitive columns, no payload. Intended for smart syncs so
// callers can skip resources that have not changed since their last cursor.
async function handleWatermarks(ctx: RequestContext): Promise<{ res: Response; rowsReturned: number }> {
  let discovered: Map<string, { columns: string[]; kind: string }>;
  try {
    discovered = await getDiscovery(ctx);
  } catch {
    return {
      res: errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId),
      rowsReturned: 0,
    };
  }
  const tableNames = Array.from(discovered.keys()).sort();
  const resources = [] as Array<{
    resource: string;
    incremental_column: string | null;
    supports_updated_since: boolean;
    latest_updated_at: string | null;
    record_count: number | null;
  }>;
  for (const t of tableNames) {
    const cols: string[] = discovered.get(t)?.columns ?? [];
    const incrementalCol = INCREMENTAL_CANDIDATES.find((c) => cols.includes(c)) ?? null;
    const resStart = Date.now();
    const [rowCount, latest] = await Promise.all([
      exactRowCount(ctx.supabase, t),
      latestUpdatedAt(ctx.supabase, t, incrementalCol),
    ]);
    // Per-resource audit line so we can correlate a /watermarks response
    // with what each individual export would see. Emitted before the
    // aggregate audit at the request level.
    console.log(JSON.stringify({
      kind: "be_eight_watermarks_resource",
      request_id: ctx.requestId,
      resource: t,
      incremental_column: incrementalCol,
      record_count: rowCount,
      latest_updated_at: latest,
      duration_ms: Date.now() - resStart,
    }));
    resources.push({
      resource: t,
      incremental_column: incrementalCol,
      supports_updated_since: incrementalCol !== null,
      latest_updated_at: latest,
      record_count: rowCount,
    });
  }
  const res = json({
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    generated_at: new Date().toISOString(),
    scope: ctx.scope,
    resources,
  }, 200, ctx.requestId);
  return { res, rowsReturned: resources.length };
}

async function handleHealth(ctx: RequestContext): Promise<Response> {
  let tableNames: string[] = [];
  try {
    const discovered = await getDiscovery(ctx);
    tableNames = Array.from(discovered.keys()).sort();
  } catch { /* fall through with empty list */ }
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    scope: ctx.scope,
    include_sensitive: ctx.includeSensitive,
    denylist: Array.from(TABLE_DENYLIST).sort(),
    resources: {
      tables: tableNames,
      derived: DERIVED_RESOURCES,
    },
  }, 200, ctx.requestId);
}

async function handleResource(ctx: RequestContext, resource: string, url: URL): Promise<Response> {
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const cursorParam = url.searchParams.get("cursor");
  const closingId = url.searchParams.get("closing_id");
  const hotelId = url.searchParams.get("hotel_id");

  if (resource === "dre_latest_lines" || resource === "dre_latest_indicators") {
    // Row-level keyset pagination over (closing_id, id). The dedupe to the
    // latest version_number per closing happens inside the privileged RPC in
    // SQL, so no PostgREST row limit can truncate the set before dedupe. A
    // closing larger than `limit` is paginated internally — never truncated.
    const parsed = parseCursor(cursorParam);
    const afterClosingId = parsed?.value ? String(parsed.value) : null;
    const afterLineId = parsed?.id ?? null;

    const fetchPage = (
      afterClosing: string | null,
      afterLine: string | null,
      pageSize: number,
    ) =>
      ctx.supabase.rpc("be_eight_dre_latest_lines", {
        _hotel_id: hotelId,
        _closing_id: closingId,
        _only_indicators: resource === "dre_latest_indicators",
        _after_closing_id: afterClosing,
        _after_line_id: afterLine,
        _limit: pageSize,
      });

    const { data, error } = await fetchPage(afterClosingId, afterLineId, limit);
    if (error) {
      console.log(JSON.stringify({
        kind: "be_eight_export_query_error", request_id: ctx.requestId, resource,
      }));
      return errorResponse(500, "query_failed", "Query failed", ctx.requestId);
    }
    const collected = (data ?? []) as Array<Record<string, unknown>>;
    const last = collected[collected.length - 1];
    // Ask exactly `limit` rows, then probe for one row beyond the last key.
    // Requesting `limit + 1` breaks at limit=1000 because PostgREST caps the
    // response at 1000 rows, so the sentinel row never arrives and pagination
    // stops with has_more=false while millions of rows remain.
    let nextCursor: string | null = null;
    if (collected.length === limit && last) {
      const probe = await fetchPage(String(last.closing_id), String(last.id), 1);
      if (probe.error) {
        return errorResponse(500, "query_failed", "Query failed", ctx.requestId);
      }
      if (((probe.data ?? []) as unknown[]).length > 0) {
        nextCursor = encodeCursor(String(last.closing_id), String(last.id));
      }
    }
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      cursor_column: "closing_id,id",
      limit, count: collected.length, next_cursor: nextCursor, has_more: nextCursor !== null,
      rows: collected,
    }, 200, ctx.requestId);
  }

  if (resource === "rh_summary") {
    const { data, error } = await ctx.supabase
      .from("rh_employees")
      .select("hotel_id, status, gender");
    if (error) return errorResponse(500, "query_failed", "Query failed", ctx.requestId);
    const byHotel: Record<string, { hotel_id: string; total: number; ativos: number; inativos: number; male: number; female: number; other: number }> = {};
    for (const row of (data ?? []) as Array<{ hotel_id: string; status: string; gender: string | null }>) {
      const h = row.hotel_id;
      if (!byHotel[h]) byHotel[h] = { hotel_id: h, total: 0, ativos: 0, inativos: 0, male: 0, female: 0, other: 0 };
      byHotel[h].total++;
      if (row.status === "ativo") byHotel[h].ativos++; else byHotel[h].inativos++;
      const g = (row.gender ?? "").toUpperCase();
      if (g === "M") byHotel[h].male++;
      else if (g === "F") byHotel[h].female++;
      else byHotel[h].other++;
    }
    const all = Object.values(byHotel).sort((a, b) => a.hotel_id.localeCompare(b.hotel_id));
    const parsed = parseCursor(cursorParam);
    const startIdx = parsed?.value
      ? all.findIndex((r) => r.hotel_id > String(parsed.value))
      : 0;
    const sliceStart = startIdx === -1 ? all.length : startIdx;
    const page = all.slice(sliceStart, sliceStart + limit);
    const hasMore = sliceStart + page.length < all.length;
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1].hotel_id, null) : null;
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      limit, count: page.length, next_cursor: nextCursor, has_more: hasMore, rows: page,
    }, 200, ctx.requestId);
  }

  if (resource === "table_counts") {
    const parsed = parseCursor(cursorParam);
    const startToken = parsed?.value ? String(parsed.value) : "";
    let allTables: string[];
    try {
      allTables = Array.from((await getDiscovery(ctx)).keys()).sort();
    } catch {
      return errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId);
    }
    const remaining = allTables.filter((t) => t > startToken);
    const page = remaining.slice(0, limit);
    const rows: Array<{ table: string; row_count: number | null }> = [];
    for (const t of page) {
      rows.push({ table: t, row_count: await approxRowCount(ctx.supabase, t) });
    }
    const hasMore = remaining.length > page.length;
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1], null) : null;
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      limit, count: rows.length, next_cursor: nextCursor, has_more: hasMore, rows,
    }, 200, ctx.requestId);
  }

  if (resource === "latest_updates") {
    const parsed = parseCursor(cursorParam);
    const startToken = parsed?.value ? String(parsed.value) : "";
    let discovered: Map<string, { columns: string[]; kind: string }>;
    try {
      discovered = await getDiscovery(ctx);
    } catch {
      return errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId);
    }
    const allTables = Array.from(discovered.keys()).sort();
    const remaining = allTables.filter((t) => t > startToken);
    const page = remaining.slice(0, limit);
    const rows: Array<{ table: string; column: string | null; latest: string | null }> = [];
    for (const t of page) {
      const cols = discovered.get(t)?.columns ?? [];
      const col = INCREMENTAL_CANDIDATES.find((c) => cols.includes(c)) ?? null;
      if (!col) { rows.push({ table: t, column: null, latest: null }); continue; }
      const { data, error } = await ctx.supabase
        .from(t).select(col).order(col, { ascending: false }).limit(1);
      if (error) { rows.push({ table: t, column: col, latest: null }); continue; }
      const latest = data && data[0] ? (data[0] as Record<string, string>)[col] : null;
      rows.push({ table: t, column: col, latest });
    }
    const hasMore = remaining.length > page.length;
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1], null) : null;
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      limit, count: rows.length, next_cursor: nextCursor, has_more: hasMore, rows,
    }, 200, ctx.requestId);
  }

  // Base resources: fall through to the catalog-validated table export so that
  // /export?resource=<new_business_table> works automatically.
  let discovered: Map<string, { columns: string[]; kind: string }>;
  try {
    discovered = await getDiscovery(ctx);
  } catch {
    return errorResponse(500, "discovery_failed", "Catalog unavailable", ctx.requestId);
  }
  if (discovered.has(resource)) {
    return await exportTable(ctx, resource, url);
  }
  return errorResponse(404, "resource_not_found", "Unknown resource", ctx.requestId);
}

Deno.serve(async (req) => {
  const requestId = newRequestId();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Only GET is supported", requestId);
  }

  const startedAtAuth = Date.now();
  const env = (k: string) => Deno.env.get(k);
  const authLog = (extra: Record<string, unknown>) => {
    // Auth audit line. Never contains the bearer token, the JWT, its payload
    // or its signature.
    console.log(JSON.stringify({
      kind: "be_eight_export_auth",
      request_id: requestId,
      at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtAuth,
      ...extra,
    }));
  };

  // --- Authentication (fully validated BEFORE any service_role client) ------
  const authResult = await authenticate(req.headers.get("Authorization"), env);
  if (!authResult.ok) {
    authLog({ result: "denied", status: authResult.status, reason: authResult.reason });
    return errorResponse(authResult.status, authResult.errorCode, authResult.message, requestId);
  }
  const authMode: AuthMode = authResult.mode;
  const sub = authResult.sub;
  const kid = authResult.kid;

  // --- Rate limiting per credential subject (fail-closed) ------------------
  const rl = checkRateLimit(`${authMode}:${sub}`, rateLimitMax(env));
  if (!rl.allowed) {
    authLog({ result: "rate_limited", status: 429, auth_mode: authMode, sub });
    return errorResponse(429, "rate_limited", "Too many requests", requestId);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // --- Replay protection (JWT only: one jti per request) -------------------
  if (authMode === "jwt" && authResult.jti) {
    try {
      const jtiHash = await sha256Hex(`${sub}:${authResult.jti}`);
      const expiresAt = new Date((authResult.exp ?? Math.floor(Date.now() / 1000) + 300) * 1000)
        .toISOString();
      const { error: replayErr } = await supabase
        .from("be_eight_jti_replay")
        .insert({ jti_hash: jtiHash, subject: sub, expires_at: expiresAt });
      if (replayErr) {
        authLog({ result: "denied", status: 401, reason: "jti_replay_or_store_error", auth_mode: authMode, sub, kid });
        return errorResponse(401, "unauthorized", "Invalid or missing credentials", requestId);
      }
      // Opportunistic, safe cleanup of already-expired records.
      supabase.rpc("be_eight_purge_expired_jti").then(() => {}, () => {});
    } catch {
      authLog({ result: "denied", status: 401, reason: "replay_check_failed", auth_mode: authMode, sub, kid });
      return errorResponse(401, "unauthorized", "Invalid or missing credentials", requestId);
    }
  }

  const scope: "standard" | "privileged" = authResult.scope;
  const url = new URL(req.url);
  const includeSensitiveParam = (url.searchParams.get("include_sensitive") ?? "").toLowerCase();
  const wantsSensitive = includeSensitiveParam === "true" || includeSensitiveParam === "1";
  if (wantsSensitive && !authResult.scopes.includes(SCOPE_SENSITIVE)) {
    authLog({ result: "denied", status: 403, reason: "missing_sensitive_scope", auth_mode: authMode, sub, kid });
    return errorResponse(
      403,
      "forbidden_scope",
      "include_sensitive requires the export:sensitive scope",
      requestId,
    );
  }
  const includeSensitive = wantsSensitive && scope === "privileged";
  const ctx: RequestContext = { requestId, supabase, scope, includeSensitive };

  // Strip the function base prefix to get the action.
  const path = url.pathname.replace(/^.*\/be-eight-export/, "") || "/";
  const startedAt = Date.now();
  const resourceParam =
    url.searchParams.get("resource") ?? url.searchParams.get("table") ?? null;
  const updatedSinceParam = url.searchParams.get("updated_since");

  const audit = (extra: Record<string, unknown>) => {
    console.log(JSON.stringify({
      kind: "be_eight_export_audit",
      request_id: requestId,
      auth_mode: authMode,
      sub,
      kid,
      scope,
      include_sensitive: includeSensitive,
      method: req.method,
      path,
      resource: resourceParam,
      updated_since: updatedSinceParam,
      user_agent: req.headers.get("user-agent") ?? null,
      at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      ...extra,
    }));
  };

  const rowsFromBody = async (res: Response): Promise<{ res: Response; rows: number }> => {
    try {
      const cloned = res.clone();
      const body = await cloned.json() as { count?: number; rows?: unknown[] };
      const rows = typeof body?.count === "number"
        ? body.count
        : Array.isArray(body?.rows) ? body.rows.length : 0;
      return { res, rows };
    } catch {
      return { res, rows: 0 };
    }
  };

  try {
    let response: Response;
    let rowsReturned = 0;
    if (path === "/" || path === "" || path === "/health") {
      response = await handleHealth(ctx);
    } else if (path === "/manifest") {
      response = await handleManifest(ctx);
    } else if (path === "/watermarks") {
      const r = await handleWatermarks(ctx);
      response = r.res;
      rowsReturned = r.rowsReturned;
    } else if (path === "/export") {
      const resource = url.searchParams.get("resource");
      if (!resource) {
        response = errorResponse(400, "missing_param", "resource is required", requestId);
      } else {
        const r = await rowsFromBody(await handleResource(ctx, resource, url));
        response = r.res;
        rowsReturned = r.rows;
      }
    } else if (path === "/export-table") {
      const table = url.searchParams.get("table");
      if (!table) {
        response = errorResponse(400, "missing_param", "table is required", requestId);
      } else {
        const r = await rowsFromBody(await exportTable(ctx, table, url));
        response = r.res;
        rowsReturned = r.rows;
      }
    } else {
      response = errorResponse(404, "not_found", `Unknown path: ${path}`, requestId);
    }
    audit({ status: response.status, rows_returned: rowsReturned });
    return response;
  } catch (err) {
    // Internal detail stays in the log; the caller only gets a request_id.
    audit({ status: 500, rows_returned: 0, error: err instanceof Error ? err.message : "unknown" });
    return errorResponse(500, "internal_error", "Internal error", requestId);
  }
});