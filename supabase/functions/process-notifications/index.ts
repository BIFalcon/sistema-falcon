// Edge function: drena a fila lógica `notification_queue` enfileirando
// cada mensagem na pgmq `transactional_emails`, que é processada pelo
// cron `process-email-queue` a cada 5s.

import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL") ?? "https://sistema-falcon.lovable.app";
const SENDER_DOMAIN = "notify.falconhoteis.com.br";
const FROM_ADDRESS = `Sistema Falcon <noreply@${SENDER_DOMAIN}>`;

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // Aceita: (a) service-role (cron/admin), (b) master autenticado.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  let authorized = false;

  if (token && token === serviceKey) {
    authorized = true;
  } else if (token) {
    const claims = parseJwtClaims(token);
    if (claims?.role === "service_role") {
      authorized = true;
    } else if (claims?.sub) {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: isMaster } = await admin.rpc("is_master", { _user_id: claims.sub });
      if (isMaster === true) authorized = true;
    }
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Pega lote de pendentes (limite 50)
  const { data: pending, error } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: "queue empty" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let enqueued = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      // Re-aponta links relativos para a URL absoluta da app.
      const linkHref = item.link_url
        ? (String(item.link_url).startsWith("http") ? String(item.link_url) : `${APP_BASE_URL}${item.link_url}`)
        : APP_BASE_URL;
      const bodyMd = String(item.body_md ?? "").replace(/\]\((\/[^)]+)\)/g, `](${APP_BASE_URL}$1)`);
      const bodyHtml = bodyMd
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#1e40af;text-decoration:underline;">$1</a>')
        .replace(/\n/g, "<br/>");

      const html = `<!doctype html><html><body style="background:#ffffff;margin:0;padding:0;">
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
          <div style="font-size:14px;line-height:1.6;">${bodyHtml}</div>
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
            Sistema Falcon Hotels · <a href="${APP_BASE_URL}/notificacoes" style="color:#6b7280;">Gerenciar notificações</a>
          </div>
        </div></body></html>`;

      const messageId = `notif-${item.id}`;
      const payload = {
        message_id: messageId,
        idempotency_key: messageId,
        purpose: "transactional",
        label: `workflow:${item.event ?? "notification"}`,
        to: item.recipient_email,
        from: FROM_ADDRESS,
        sender_domain: SENDER_DOMAIN,
        subject: item.subject,
        html,
        queued_at: new Date().toISOString(),
        link_url: linkHref,
      };

      const { error: enqError } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload,
      });
      if (enqError) throw enqError;

      await supabase
        .from("notification_queue")
        .update({
          status: "dispatched",
          dispatched_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", item.id);
      enqueued++;
    } catch (err) {
      failed++;
      await supabase
        .from("notification_queue")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq("id", item.id);
    }
  }

  return new Response(
    JSON.stringify({ processed: pending.length, enqueued, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
