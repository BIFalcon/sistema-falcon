// Edge function: drena a fila lógica `notification_queue` enviando cada
// mensagem pela API gerenciada de e-mails da Lovable (envio síncrono).

import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  logEmailFailureAlert,
  logEmailSend,
  sendRawEmail,
} from "../_shared/email/send-raw-email.ts";


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

  // Extrai e normaliza endereços de e-mail de uma string que pode conter
  // múltiplos endereços (separados por ; , espaço, quebra de linha) e até
  // "Nome <email>" ou "Nome email@x.com". Evita que o provedor receba
  // algo como "Silmara silmara@x.com;maria@y.com" como destinatário único.
  function extractEmails(raw: string | null | undefined): string[] {
    if (!raw) return [];
    const matches = String(raw).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    return Array.from(new Set(matches.map((s) => s.trim().toLowerCase())));
  }



  for (const item of pending) {
    try {
      // Defensivo: aceita recipient_email com múltiplos endereços (separados
      // por ; , espaço ou contendo nome). Cada destinatário vira um job
      // independente — falha de um endereço inválido não derruba os demais.
      const recipients = extractEmails(item.recipient_email);
      if (recipients.length === 0) {
        await supabase
          .from("notification_queue")
          .update({
            status: "failed",
            error_message: `Endereço inválido: "${item.recipient_email ?? ""}"`,
          })
          .eq("id", item.id);
        failed++;
        continue;
      }

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

      // Plain text version (required by the email API)
      const text = `${bodyMd
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")}\n\n---\nSistema Falcon Hotels\nGerenciar notificações: ${APP_BASE_URL}/notificacoes`;

      // Envia um e-mail por destinatário (sufixo no id quando >1).
      for (let i = 0; i < recipients.length; i++) {
        const to = recipients[i];
        const messageId = recipients.length > 1 ? `notif-${item.id}-${i}` : `notif-${item.id}`;
        const label = `workflow:${item.event ?? "notification"}`;
        try {
          const result = await sendRawEmail({
            to,
            subject: String(item.subject ?? ""),
            html,
            text,
            label,
            idempotencyKey: messageId,
          });
          await logEmailSend(supabase, {
            message_id: messageId,
            template_name: label,
            recipient_email: to,
            status: result.sent ? "sent" : "suppressed",
          });
        } catch (sendErr) {
          const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          await logEmailSend(supabase, {
            message_id: messageId,
            template_name: label,
            recipient_email: to,
            status: "failed",
            error_message: sendMsg,
          });
          await logEmailFailureAlert(supabase, {
            to,
            subject: String(item.subject ?? ""),
            label,
            reason: sendMsg,
          });
          throw sendErr;
        }
      }


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
