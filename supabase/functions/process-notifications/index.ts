// Edge function: processa fila de notificações do workflow.
// Enquanto o domínio notify.falconhoteis.com.br não estiver configurado,
// marca como `skipped` com motivo "domain_not_configured".
// Quando o domínio estiver pronto, basta alterar EMAIL_DOMAIN_READY=true e
// implementar o envio real (provider já preparado).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { sendLovableEmail } from "npm:@lovable.dev/email-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_DOMAIN_READY = true; // notify.falconhoteis.com.br ativo
const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL") ?? "https://app.falconhoteis.com.br";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pega lote de pendentes (limite 50)
  const { data: pending, error } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

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

  let dispatched = 0;
  let skipped = 0;

  for (const item of pending) {
    if (!EMAIL_DOMAIN_READY) {
      await supabase
        .from("notification_queue")
        .update({
          status: "skipped",
          dispatched_at: new Date().toISOString(),
          error_message: "domain_not_configured: aguardando notify.falconhoteis.com.br",
        })
        .eq("id", item.id);
      skipped++;
      continue;
    }

    try {
      const fullLink = `${APP_BASE_URL}${item.link_url}`;

      // Converte body_md para HTML simples
      const bodyHtml = (item.body_md as string)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#1e40af;text-decoration:underline;">$1</a>')
        .replace(/\n/g, "<br/>");

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
          <div style="font-size:14px;line-height:1.6;">
            ${bodyHtml}
          </div>
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
            Sistema Falcon Hotels ·
            <a href="${APP_BASE_URL}/notificacoes" style="color:#6b7280;">Gerenciar notificações</a>
          </div>
        </div>
      `;

      await sendLovableEmail({
        from: "Sistema Falcon <noreply@notify.falconhoteis.com.br>",
        to: item.recipient_email as string,
        subject: item.subject as string,
        html,
      });

      await supabase
        .from("notification_queue")
        .update({
          status: "dispatched",
          dispatched_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      dispatched++;
    } catch (err) {
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
    JSON.stringify({
      processed: pending.length,
      dispatched,
      skipped,
      domain_ready: EMAIL_DOMAIN_READY,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
