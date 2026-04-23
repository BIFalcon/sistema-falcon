// Edge function: processa fila de notificações do workflow.
// Enquanto o domínio notify.falconhoteis.com.br não estiver configurado,
// marca como `skipped` com motivo "domain_not_configured".
// Quando o domínio estiver pronto, basta alterar EMAIL_DOMAIN_READY=true e
// implementar o envio real (provider já preparado).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_DOMAIN_READY = false; // mudar para true quando notify.falconhoteis.com.br estiver ativo
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

    // === Quando o domínio estiver pronto, envio real entra aqui ===
    // Exemplo (Resend/Lovable Email): construir HTML a partir de body_md,
    // adicionar link absoluto APP_BASE_URL + link_url e footer de unsubscribe.
    try {
      const fullLink = `${APP_BASE_URL}${item.link_url}`;
      console.log(
        `[notify] would send ${item.event} to ${item.recipient_email} → ${fullLink}`,
      );
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
