// Be Eight read-only export API for Falcon Hoteis.
// Auth: Authorization: Bearer <BE_EIGHT_EXPORT_TOKEN>
// Only SELECT operations. Returns JSON. Paginated, max 1000 rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SCHEMA_VERSION = "falcon-lovable-export-v1";
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Per-table column blocklist to avoid exposing secrets/credentials/tokens.
const COLUMN_BLOCKLIST: Record<string, string[]> = {
  email_unsubscribe_tokens: ["token", "token_hash"],
  profiles: [],
  user_permissions: [],
  system_settings: [],
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
];

// Allowlist of exportable tables.
const TABLE_ALLOWLIST = [
  "ap_anticipation",
  "ap_bank_balance",
  "ap_card_receivable",
  "ap_documents",
  "ap_entries",
  "ap_notification_log",
  "ap_uploads",
  "approvals",
  "ar_client_contracts",
  "ar_clients",
  "ar_open_folio_date_history",
  "ar_open_folio_entries",
  "ar_open_folio_notes",
  "ar_to_invoice_entries",
  "ar_uploads",
  "closing_status_log",
  "closings",
  "comments",
  "conciliation_journal_lines",
  "conciliation_razao_lines",
  "conciliation_uploads",
  "dre_parsed_lines",
  "dre_versions",
  "email_send_log",
  "email_send_state",
  "email_unsubscribe_tokens",
  "hotels",
  "investor_letters",
  "letter_highlights",
  "letter_versions",
  "notification_queue",
  "notification_unsubscribes",
  "profiles",
  "rh_calendar_dates",
  "rh_calendar_posts",
  "rh_employees",
  "rh_org_nodes",
  "rh_org_responsibilities",
  "rh_policies",
  "rh_trainings",
  "rh_uploads",
  "suppressed_emails",
  "system_settings",
  "user_hotels",
  "user_permissions",
  "user_roles",
];

// Derived resources exposed via /export?resource=...
const DERIVED_RESOURCES = [
  "dre_latest_lines",
  "dre_latest_indicators",
  "rh_summary",
  "table_counts",
  "latest_updates",
];

// Candidate columns used to choose cursor / incremental column.
const INCREMENTAL_CANDIDATES = ["updated_at", "created_at", "uploaded_at", "sent_at"];
const CURSOR_CANDIDATES = ["updated_at", "created_at", "uploaded_at", "sent_at", "id"];

interface RequestContext {
  requestId: string;
  supabase: ReturnType<typeof createClient>;
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

function stripSensitive<T extends Record<string, unknown>>(table: string, row: T): T {
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
  if (!TABLE_ALLOWLIST.includes(table)) {
    return errorResponse(400, "table_not_allowed", `Table "${table}" is not in the allowlist`, ctx.requestId);
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

  let cols: string[];
  try {
    cols = await getTableColumns(ctx.supabase, table);
  } catch (e) {
    return errorResponse(500, "introspection_failed", e instanceof Error ? e.message : "unknown", ctx.requestId);
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

  const rows = (data ?? []).map((r) => stripSensitive(table, r as Record<string, unknown>));
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
    count: rows.length,
    next_cursor: nextCursor,
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
  const tables = [];
  for (const t of TABLE_ALLOWLIST) {
    let cols: string[] = [];
    try { cols = await getTableColumns(ctx.supabase, t); } catch { cols = []; }
    const visible = cols.filter((c) => !isSensitiveColumn(t, c));
    const cursorCol = CURSOR_CANDIDATES.find((c) => cols.includes(c)) ?? "id";
    const incrementalCol = INCREMENTAL_CANDIDATES.find((c) => cols.includes(c)) ?? null;
    const rowCount = await approxRowCount(ctx.supabase, t);
    tables.push({
      table: t,
      columns: visible,
      hidden_columns: cols.filter((c) => isSensitiveColumn(t, c)),
      row_count: rowCount,
      cursor_column: cursorCol,
      incremental_column: incrementalCol,
      contains_sensitive: cols.some((c) => isSensitiveColumn(t, c)),
    });
  }
  return json({
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    generated_at: new Date().toISOString(),
    tables,
    derived_resources: DERIVED_RESOURCES,
  }, 200, ctx.requestId);
}

async function handleHealth(ctx: RequestContext): Promise<Response> {
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    request_id: ctx.requestId,
    resources: {
      tables: TABLE_ALLOWLIST,
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
    // Find latest version per closing_id and return its rows.
    let closingsQ = ctx.supabase.from("closings").select("id, hotel_id").order("id", { ascending: true }).limit(limit);
    if (hotelId) closingsQ = closingsQ.eq("hotel_id", hotelId);
    if (closingId) closingsQ = closingsQ.eq("id", closingId);
    const parsed = parseCursor(cursorParam);
    if (parsed?.value) closingsQ = closingsQ.gt("id", parsed.value as never);

    const { data: closingsData, error: cErr } = await closingsQ;
    if (cErr) return errorResponse(500, "query_failed", cErr.message, ctx.requestId);
    const ids = (closingsData ?? []).map((c) => (c as { id: string }).id);
    if (ids.length === 0) {
      return json({
        schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
        count: 0, next_cursor: null, rows: [],
      }, 200, ctx.requestId);
    }

    const { data: linesData, error: lErr } = await ctx.supabase
      .rpc("get_latest_dre_lines_by_closings", { _closing_ids: ids });
    if (lErr) return errorResponse(500, "rpc_failed", lErr.message, ctx.requestId);

    let rows = (linesData ?? []) as Array<{ line_type: string }>;
    if (resource === "dre_latest_indicators") {
      rows = rows.filter((r) => r.line_type === "indicator");
    }
    const nextCursor = ids.length === limit ? encodeCursor(ids[ids.length - 1], null) : null;
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      count: rows.length, next_cursor: nextCursor, rows,
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
    const rows = Object.values(byHotel);
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      count: rows.length, next_cursor: null, rows,
    }, 200, ctx.requestId);
  }

  if (resource === "table_counts") {
    const rows: Array<{ table: string; row_count: number | null }> = [];
    for (const t of TABLE_ALLOWLIST) {
      rows.push({ table: t, row_count: await approxRowCount(ctx.supabase, t) });
    }
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      count: rows.length, next_cursor: null, rows,
    }, 200, ctx.requestId);
  }

  if (resource === "latest_updates") {
    const rows: Array<{ table: string; column: string | null; latest: string | null }> = [];
    for (const t of TABLE_ALLOWLIST) {
      let col: string | null = null;
      try { col = await pickColumn(ctx.supabase, t, INCREMENTAL_CANDIDATES); } catch { col = null; }
      if (!col) { rows.push({ table: t, column: null, latest: null }); continue; }
      const { data, error } = await ctx.supabase
        .from(t).select(col).order(col, { ascending: false }).limit(1);
      if (error) { rows.push({ table: t, column: col, latest: null }); continue; }
      const latest = data && data[0] ? (data[0] as Record<string, string>)[col] : null;
      rows.push({ table: t, column: col, latest });
    }
    return json({
      schema_version: SCHEMA_VERSION, request_id: ctx.requestId, resource,
      count: rows.length, next_cursor: null, rows,
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
  if (!expected) {
    return errorResponse(500, "server_misconfigured", "Export token not configured", requestId);
  }
  const auth = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || m[1] !== expected) {
    return errorResponse(401, "unauthorized", "Invalid or missing bearer token", requestId);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const ctx: RequestContext = { requestId, supabase };

  const url = new URL(req.url);
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