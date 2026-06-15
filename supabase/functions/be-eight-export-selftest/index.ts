// Temporary self-test for be-eight-export. Calls the live function with the
// privileged token from env and returns a compact summary. Safe to delete
// after verification — does not expose secrets.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/be-eight-export`;
  const priv = Deno.env.get("BE_EIGHT_EXPORT_PRIVILEGED_TOKEN");
  const std = Deno.env.get("BE_EIGHT_EXPORT_TOKEN");
  const hdrs = (t: string | undefined) => ({ Authorization: `Bearer ${t ?? ""}` });

  const out: Record<string, unknown> = {};

  // Manifest with privileged + include_sensitive=true
  {
    const r = await fetch(`${base}/manifest?include_sensitive=true`, { headers: hdrs(priv) });
    const body = await r.json();
    const tables = (body.tables ?? []) as Array<{ table: string; incremental_column: string | null }>;
    out.manifest_status = r.status;
    out.schema_version = body.schema_version;
    out.denylist = body.denylist;
    out.table_count = tables.length;
    out.table_to_incremental = Object.fromEntries(tables.map((t) => [t.table, t.incremental_column]));
    out.missing_incremental = tables.filter((t) => !t.incremental_column).map((t) => t.table);
    out.contains_ar_clients = tables.some((t) => t.table === "ar_clients");
    out.contains_email_unsubscribe_tokens = tables.some((t) => t.table === "email_unsubscribe_tokens");
  }

  // Standard token must NOT be allowed to use include_sensitive=true
  {
    const r = await fetch(`${base}/manifest?include_sensitive=true`, { headers: hdrs(std) });
    const body = await r.json();
    out.standard_with_sensitive_status = r.status;
    out.standard_with_sensitive_error = body.error_code;
  }

  // ar_clients should 400 table_not_allowed (not 500)
  {
    const r = await fetch(`${base}/export-table?table=ar_clients&include_sensitive=true`, { headers: hdrs(priv) });
    const body = await r.json();
    out.ar_clients_status = r.status;
    out.ar_clients_error = body.error_code;
  }

  // Probe each exportable table with a far-future updated_since: expect 200 + 0 rows.
  {
    const tables = Object.keys((out.table_to_incremental as Record<string, string | null>) ?? {});
    const results: Array<{ table: string; status: number; count: number | null; error?: string }> = [];
    const chunk = 4;
    for (let i = 0; i < tables.length; i += chunk) {
      const slice = tables.slice(i, i + chunk);
      const batch = await Promise.all(slice.map(async (t) => {
        const r = await fetch(
          `${base}/export-table?table=${encodeURIComponent(t)}&updated_since=2099-01-01T00:00:00Z&include_sensitive=true&limit=1`,
          { headers: hdrs(priv) },
        );
        const body = await r.json().catch(() => ({}));
        return { table: t, status: r.status, count: body.count ?? null, error: body.error_code };
      }));
      results.push(...batch);
      await new Promise((r) => setTimeout(r, 150));
    }
    out.future_probe_results = results;
    out.future_probe_failures = results.filter((r) => r.status !== 200 || (r.count ?? -1) !== 0);
  }

  // Cursor pagination smoke test on a small table (hotels)
  {
    const r1 = await fetch(`${base}/export-table?table=hotels&limit=1&include_sensitive=true`, { headers: hdrs(priv) });
    const b1 = await r1.json();
    let r2status: number | null = null;
    let b2count: number | null = null;
    if (b1.next_cursor) {
      const r2 = await fetch(
        `${base}/export-table?table=hotels&limit=1&include_sensitive=true&cursor=${encodeURIComponent(b1.next_cursor)}`,
        { headers: hdrs(priv) },
      );
      const b2 = await r2.json();
      r2status = r2.status;
      b2count = b2.count;
    }
    out.pagination = { first_status: r1.status, first_count: b1.count, has_next: !!b1.next_cursor, second_status: r2status, second_count: b2count };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});