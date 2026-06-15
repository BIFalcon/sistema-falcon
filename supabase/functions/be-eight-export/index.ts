// Be Eight read-only export API for Falcon Hoteis.
// Auth: Authorization: Bearer <BE_EIGHT_EXPORT_TOKEN>
// Only SELECT operations. Returns JSON. Paginated, max 1000 rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SCHEMA_VERSION = "falcon-lovable-export-v3";
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Per-table column blocklist to avoid exposing secrets/credentials/tokens when
// `include_sensitive` is NOT enabled. Privileged callers with
// `include_sensitive=true` receive every column.
const COLUMN_BLOCKLIST: Record<string, string[]> = {
  profiles: [],
  user_permissions: [],
  system_settings: [],
  rh_employees: ["cpf", "salary", "birth_date", "raw"],
  hotels: ["bank_accounts", "cnpj"],
};

// Global column-name patterns that are always stripped, regardless of table.
const GLOBAL_SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /service_role/i,
  /^api_key$/i,
  /access_token/i,
  /refresh_token/i,
  /private_key/i,
  /token$/i,
  /_token$/i,
  /token_hash/i,
  /_hash$/i,
  /signed_url/i,
  /credentials?/i,
  /^cpf$/i,
  /salary/i,
  /birth_date/i,
  /bank_accounts/i,
  /cnpj/i,
];

// Minimal denylist: tables that should NEVER be exported (technical /
// security artifacts, raw tokens, credentials, internal migrations). Business
// tables — even those carrying sensitive data — are NOT denied here; their
// sensitivity is handled per-column via COLUMN_BLOCKLIST /
// GLOBAL_SENSITIVE_PATTERNS and the `include_sensitive` privileged flag.
const TABLE_DENYLIST = new Set<string>([
  // Raw unsubscribe token store — contains opaque security tokens, not
  // business data. Bounce / unsubscribe behaviour is still exportable via
  // `notification_unsubscribes` and `suppressed_emails`.
  "email_unsubscribe_tokens",
]);

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
  "unsubscribed_at",
  "suppressed_at",
  "approved_at",
  "paid_at",
  "created_at",
];
const CURSOR_CANDIDATES = [...INCREMENTAL_CANDIDATES, "id"];

interface RequestContext {
  requestId: string;
  supabase: ReturnType<typeof createClient>;
  scope: "standard" | "privileged";
  includeSensitive: boolean;
  discovery?: Promise<Map<string, string[]>>;
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

function isSensitiveColumn(table: string, column: string): boolean {
  if (GLOBAL_SENSITIVE_PATTERNS.some((re) => re.test(column))) return true;
  const list = COLUMN_BLOCKLIST[table];
  if (list && list.includes(column)) return true;
  return false;
}

function stripSensitive<T extends Record<string, unknown>>(
  table: string,
  row: T,
  includeSensitive: boolean,
): T {
  if (includeSensitive) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isSensitiveColumn(table, k)) continue;
    out[k] = v;
  }
  return out as T;
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

// Discover all exportable public-schema base tables via a service_role-only
// RPC. Tables in TABLE_DENYLIST are filtered out. Returns a map of
// table_name -> column list. Cached per request via ctx.discovery.
async function discoverTables(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc("be_eight_list_tables");
  if (error) throw new Error(`discovery_failed: ${error.message}`);
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ table_name: string; columns: string[] }>) {
    if (TABLE_DENYLIST.has(row.table_name)) continue;
    map.set(row.table_name, row.columns ?? []);
  }
  return map;
}

async function getDiscovery(ctx: RequestContext): Promise<Map<string, string[]>> {
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

function parseCursor(cursor: string | null): { value: unknown; id: string | null } | null {
  if (!cursor) return null;
  try {
    const decoded = atob(cursor);
    const obj = JSON.parse(decoded);
    return { value: obj.v ?? null, id: obj.id ?? null };
  } catch {
    return null;
  }
}

function encodeCursor(value: unknown, id: string | null): string {
  return btoa(JSON.stringify({ v: value, id }));
}

async function exportTable(
  ctx: RequestContext,
  table: string,
  url: URL,
): Promise<Response> {
  let discovered: Map<string, string[]>;
  try {
    discovered = await getDiscovery(ctx);
  } catch (e) {
    return errorResponse(500, "discovery_failed", e instanceof Error ? e.message : "unknown", ctx.requestId);
  }
  if (!discovered.has(table)) {
    return errorResponse(
      400,
      "table_not_allowed",
      `Table "${table}" is not exportable (missing or denied)`,
      ctx.requestId,
    );
  }

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
  let cols: string[] = discovered.get(table) ?? [];
  if (cols.length === 0) {
    try {
      cols = await getTableColumns(ctx.supabase, table);
    } catch (e) {
      return errorResponse(500, "introspection_failed", e instanceof Error ? e.message : "unknown", ctx.requestId);
    }
  }

  const hasCol = (c: string) => cols.includes(c);

  // Determine cursor column.
  let cursorCol: string | null = null;
  for (const c of CURSOR_CANDIDATES) {
    if (hasCol(c)) { cursorCol = c; break; }
  }
  if (!cursorCol) {
    // Empty table sample => no introspected cols. Try common fallbacks.
    cursorCol = "id";
  }

  // Incremental column.
  let incrementalCol: string | null = null;
  for (const c of INCREMENTAL_CANDIDATES) {
    if (hasCol(c)) { incrementalCol = c; break; }
  }

  let q = ctx.supabase.from(table).select("*").limit(limit);

  // Deterministic ordering.
  q = q.order(cursorCol, { ascending: true });
  if (cursorCol !== "id" && hasCol("id")) {
    q = q.order("id", { ascending: true });
  }

  // Filters.
  if (hotelId && hasCol("hotel_id")) q = q.eq("hotel_id", hotelId);
  if (closingId && hasCol("closing_id")) q = q.eq("closing_id", closingId);
  if (year && hasCol("year")) q = q.eq("year", Number(year));
  if (month && hasCol("month")) q = q.eq("month", Number(month));

  if (updatedSince && incrementalCol) {
    q = q.gte(incrementalCol, updatedSince);
  }
  if (uploadedSince && hasCol("uploaded_at")) {
    q = q.gte("uploaded_at", uploadedSince);
  }

  // Cursor pagination.
  const parsed = parseCursor(cursorParam);
  if (parsed && parsed.value !== null && parsed.value !== undefined) {
    if (cursorCol !== "id" && hasCol("id") && parsed.id) {
      // (cursorCol, id) > (parsed.value, parsed.id) — emulate via or().
      q = q.or(
        `${cursorCol}.gt.${parsed.value},and(${cursorCol}.eq.${parsed.value},id.gt.${parsed.id})`,
      );
    } else {
      q = q.gt(cursorCol, parsed.value as never);
    }
  }

  const { data, error } = await q;
  if (error) {
    return errorResponse(500, "query_failed", error.message, ctx.requestId);
  }

  const rows = (data ?? []).map((r) =>
    stripSensitive(table, r as Record<string, unknown>, ctx.includeSensitive),
  );
  let nextCursor: string | null = null;
  if (rows.length === limit && data && data.length > 0) {
    const last = data[data.length - 1] as Record<string, unknown>;
    nextCursor = encodeCursor(last[cursorCol], (last.id as string) ?? null);
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

async function handleManifest(ctx: RequestContext): Promise<Response> {
  let discovered: Map<string, string[]>;
  try {
    discovered = await getDiscovery(ctx);
  } catch (e) {
    return errorResponse(500, "discovery_failed", e instanceof Error ? e.message : "unknown", ctx.requestId);
  }
  const tableNames = Array.from(discovered.keys()).sort();
  const tables = [];
  for (const t of tableNames) {
    const cols: string[] = discovered.get(t) ?? [];
    const sensitive = cols.filter((c) => isSensitiveColumn(t, c));
    const visible = ctx.includeSensitive ? cols : cols.filter((c) => !isSensitiveColumn(t, c));
    const cursorCol = CURSOR_CANDIDATES.find((c) => cols.includes(c)) ?? "id";
    const incrementalCol = INCREMENTAL_CANDIDATES.find((c) => cols.includes(c)) ?? null;
    const rowCount = await approxRowCount(ctx.supabase, t);
    // In privileged + include_sensitive mode, no columns are blocked from the
    // payload, but the manifest still flags them as sensitive for auditing.
    const blocked = ctx.includeSensitive ? [] : sensitive;
    tables.push({
      table: t,
      columns: visible,
      hidden_columns: blocked,
      blocked_columns: blocked,
      sensitive_columns: sensitive,
      row_count: rowCount,
      cursor_column: cursorCol,
      incremental_column: incrementalCol,
      supports_cursor: true,
      supports_updated_since: incrementalCol !== null,
      non_paginated: false,
      contains_sensitive: sensitive.length > 0,
      contains_sensitive_data: sensitive.length > 0,
    });
  }
  const derived = [
    { resource: "dre_latest_lines", cursor_column: "closing_id", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
    { resource: "dre_latest_indicators", cursor_column: "closing_id", incremental_column: null, supports_cursor: true, supports_updated_since: false, blocked_columns: [], contains_sensitive_data: false, non_paginated: false },
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
    // Keyset pagination by closing_id. Fetch a window of closings, then load
    // only their latest DRE lines via RPC. The cursor advances over closings,
    // not over lines, but the response still respects `limit` by returning at
    // most `limit` rows per page (lines that don't fit are deferred).
    const parsed = parseCursor(cursorParam);
    const batchSize = Math.min(50, limit);
    let collected: Array<Record<string, unknown>> = [];
    let lastClosingId: string | null = parsed?.value ? String(parsed.value) : null;
    let exhausted = false;

    while (collected.length < limit) {
      let closingsQ = ctx.supabase
        .from("closings")
        .select("id, hotel_id")
        .order("id", { ascending: true })
        .limit(batchSize);
      if (hotelId) closingsQ = closingsQ.eq("hotel_id", hotelId);
      if (closingId) closingsQ = closingsQ.eq("id", closingId);
      if (lastClosingId) closingsQ = closingsQ.gt("id", lastClosingId);

      const { data: closingsData, error: cErr } = await closingsQ;
      if (cErr) return errorResponse(500, "query_failed", cErr.message, ctx.requestId);
      const batch = (closingsData ?? []) as Array<{ id: string }>;
      if (batch.length === 0) { exhausted = true; break; }

      const ids = batch.map((c) => c.id);
      const { data: linesData, error: lErr } = await ctx.supabase
        .rpc("get_latest_dre_lines_by_closings", { _closing_ids: ids });
      if (lErr) return errorResponse(500, "rpc_failed", lErr.message, ctx.requestId);

      let lines = (linesData ?? []) as Array<{ closing_id: string; line_type: string }>;
      if (resource === "dre_latest_indicators") {
        lines = lines.filter((r) => r.line_type === "indicator");
      }
      // Group by closing_id (preserve closing order).
      const byClosing = new Map<string, Array<Record<string, unknown>>>();
      for (const id of ids) byClosing.set(id, []);
      for (const l of lines) {
        const arr = byClosing.get(l.closing_id);
        if (arr) arr.push(l as unknown as Record<string, unknown>);
      }

      let stopped = false;
      for (const id of ids) {
        const arr = byClosing.get(id) ?? [];
        if (collected.length + arr.length > limit) {
          // Don't split a closing across pages — stop before it.
          if (collected.length === 0) {
            // A single closing exceeds limit; truncate to keep contract.
            collected = arr.slice(0, limit);
            lastClosingId = id;
          }
          stopped = true;
          break;
        }
        collected = collected.concat(arr);
        lastClosingId = id;
        if (collected.length >= limit) { stopped = true; break; }
      }
      if (stopped) break;
      if (batch.length < batchSize) { exhausted = true; break; }
      if (closingId) { exhausted = true; break; }
    }

    const hasMore = !exhausted;
    const nextCursor = hasMore && lastClosingId ? encodeCursor(lastClosingId, null) : null;
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      limit, count: collected.length, next_cursor: nextCursor, has_more: hasMore,
      rows: collected,
    }, 200, ctx.requestId);
  }

  if (resource === "rh_summary") {
    const { data, error } = await ctx.supabase
      .from("rh_employees")
      .select("hotel_id, status, gender");
    if (error) return errorResponse(500, "query_failed", error.message, ctx.requestId);
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
    const remaining = TABLE_ALLOWLIST.filter((t) => t > startToken);
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
    const remaining = TABLE_ALLOWLIST.filter((t) => t > startToken);
    const page = remaining.slice(0, limit);
    const rows: Array<{ table: string; column: string | null; latest: string | null }> = [];
    for (const t of page) {
      let col: string | null = null;
      try { col = await pickColumn(ctx.supabase, t, INCREMENTAL_CANDIDATES); } catch { col = null; }
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

  return errorResponse(400, "resource_not_allowed", `Resource "${resource}" not supported`, ctx.requestId);
}

Deno.serve(async (req) => {
  const requestId = newRequestId();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Only GET is supported", requestId);
  }

  // Custom token auth.
  const expected = Deno.env.get("BE_EIGHT_EXPORT_TOKEN");
  const privilegedExpected = Deno.env.get("BE_EIGHT_EXPORT_PRIVILEGED_TOKEN");
  if (!expected) {
    return errorResponse(500, "server_misconfigured", "Export token not configured", requestId);
  }
  const auth = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return errorResponse(401, "unauthorized", "Invalid or missing bearer token", requestId);
  }
  const presented = m[1];
  let scope: "standard" | "privileged";
  if (privilegedExpected && presented === privilegedExpected) {
    scope = "privileged";
  } else if (presented === expected) {
    scope = "standard";
  } else {
    return errorResponse(401, "unauthorized", "Invalid or missing bearer token", requestId);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const url = new URL(req.url);
  const includeSensitiveParam = (url.searchParams.get("include_sensitive") ?? "").toLowerCase();
  const wantsSensitive = includeSensitiveParam === "true" || includeSensitiveParam === "1";
  if (wantsSensitive && scope !== "privileged") {
    return errorResponse(
      403,
      "forbidden_scope",
      "include_sensitive requires the privileged bearer token",
      requestId,
    );
  }
  const includeSensitive = wantsSensitive && scope === "privileged";
  const ctx: RequestContext = { requestId, supabase, scope, includeSensitive };

  // Audit log (per request_id). Never logs the token value.
  const auditEntry = {
    kind: "be_eight_export_audit",
    request_id: requestId,
    scope,
    include_sensitive: includeSensitive,
    method: req.method,
    path: url.pathname,
    params: Object.fromEntries(url.searchParams.entries()),
    user_agent: req.headers.get("user-agent") ?? null,
    at: new Date().toISOString(),
  };
  console.log(JSON.stringify(auditEntry));

  // Strip the function base prefix to get the action.
  const path = url.pathname.replace(/^.*\/be-eight-export/, "") || "/";

  try {
    if (path === "/" || path === "" || path === "/health") return await handleHealth(ctx);
    if (path === "/manifest") return await handleManifest(ctx);
    if (path === "/export") {
      const resource = url.searchParams.get("resource");
      if (!resource) return errorResponse(400, "missing_param", "resource is required", requestId);
      return await handleResource(ctx, resource, url);
    }
    if (path === "/export-table") {
      const table = url.searchParams.get("table");
      if (!table) return errorResponse(400, "missing_param", "table is required", requestId);
      return await exportTable(ctx, table, url);
    }
    return errorResponse(404, "not_found", `Unknown path: ${path}`, requestId);
  } catch (err) {
    return errorResponse(500, "internal_error", err instanceof Error ? err.message : "unknown", requestId);
  }
});