// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotel_id ?? "");
    const entryIds: string[] = Array.isArray(body.entry_ids) ? body.entry_ids : [];
    const dueFrom: string | null = body.due_from ? String(body.due_from) : null; // YYYY-MM-DD
    const dueTo: string | null = body.due_to ? String(body.due_to) : null;       // YYYY-MM-DD
    const extraEmails: string[] = Array.isArray(body.extra_emails)
      ? body.extra_emails.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [];
    const customMessage: string | null = body.message ? String(body.message) : null;
    const safeCustomMessage = customMessage
      ? customMessage
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
      : null;
    if (!hotelId || entryIds.length === 0) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: isManager } = await admin.rpc("is_ap_manager", { _user_id: userId });
    const { data: isAllowed } = await admin.rpc("is_hotel_allowed", { _user_id: userId, _hotel_id: hotelId });
    if (!isManager || !isAllowed) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar dados
    const [{ data: hotel }, { data: entriesRaw }, { data: ggs }] = await Promise.all([
      admin.from("hotels").select("id,name,financial_system").eq("id", hotelId).single(),
      admin.from("ap_entries").select("*").eq("hotel_id", hotelId).in("id", entryIds),
      admin.rpc("users_with_role_for_hotel", { _role: "gg", _hotel_id: hotelId }),
    ]);

    // Filtra por intervalo de vencimento (se informado).
    const entries = (entriesRaw ?? []).filter((e: any) => {
      if (!dueFrom && !dueTo) return true;
      if (!e.due_date) return false;
      if (dueFrom && e.due_date < dueFrom) return false;
      if (dueTo && e.due_date > dueTo) return false;
      return true;
    });

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ error: "no_entries" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ggRecipients = (ggs ?? []) as { user_id: string; email: string; display_name: string | null }[];
    if (ggRecipients.length === 0 && extraEmails.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, recipients: 0, warning: "no_gg_for_hotel" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Montar corpo do e-mail
    const isOmie = (hotel as any)?.financial_system === "omie";
    const total = entries.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const lines = entries
      .sort((a: any, b: any) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
      .map((e: any) => {
        const issues: string[] = [];
        // Hotéis OMIE não usam aprovação no Falcon — a correção é feita no OMIE
        if (!isOmie && e.gg_approval !== "approved") issues.push("sem aprovação");
        if (!e.primary_document_id) issues.push("sem documento");
        if (e.omie_situation?.toLowerCase().includes("atras")) issues.push("atrasado");
        return `- **${e.supplier}** — Doc ${e.document_number ?? "—"} — Venc. ${fmtDate(e.due_date)} — ${fmtBRL(Number(e.amount))}` +
          (issues.length ? `  \n  _Pendências: ${issues.join(", ")}_` : "");
      });

    const subject = `[${hotel?.name ?? "Hotel"}] Contas a Pagar — ${entries.length} pendência(s) aguardando você`;
    const cta = isOmie
      ? `Acesse o **OMIE** para corrigir as inconsistências apontadas. Para hotéis OMIE não há aprovação pelo Falcon.`
      : `Acesse o Falcon para aprovar ou recusar.`;
    const bodyMd =
      `Olá,\n\nVocê tem **${entries.length} lançamento(s)** com pendências em **${hotel?.name ?? "seu hotel"}** ` +
      `totalizando **${fmtBRL(total)}**:\n\n` +
      lines.join("\n") +
      (safeCustomMessage ? `\n\n**Mensagem:**\n${safeCustomMessage}\n` : "") +
      `\n\n${cta}\n\n[Abrir Contas a Pagar](/financeiro/contas-pagar)`;

    const linkUrl = `/financeiro/contas-pagar`;

    // Enfileira na notification_queue (que é processada por process-notifications
    // e tem retries/DLQ/visibilidade no painel de e-mails). Para os destinatários
    // "extras" (sem user_id no sistema) usamos o próprio user_id do solicitante
    // no campo recipient_user_id (campo NOT NULL) — o e-mail efetivamente enviado
    // continua sendo o do destino informado em recipient_email.
    const rows = [
      ...ggRecipients
        .filter((g) => g.user_id && g.email)
        .map((g) => ({
          event: "ap_pendencies_to_gg",
          closing_id: "00000000-0000-0000-0000-000000000000",
          hotel_id: hotelId,
          recipient_user_id: g.user_id,
          recipient_email: g.email,
          recipient_role: "gg",
          subject,
          body_md: bodyMd,
          link_url: linkUrl,
          payload: { manual: true, entry_count: entries.length, total },
        })),
      ...extraEmails.map((email) => ({
        event: "ap_pendencies_to_gg" as const,
        closing_id: "00000000-0000-0000-0000-000000000000",
        hotel_id: hotelId,
        recipient_user_id: userId,
        recipient_email: email,
        recipient_role: "extra",
        subject,
        body_md: bodyMd,
        link_url: linkUrl,
        payload: { manual: true, extra: true, requested_by: userId },
      })),
    ];

    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, recipients: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: enqErr } = await admin.from("notification_queue").insert(rows);
    if (enqErr) throw enqErr;

    // Dispara o processador imediatamente (best-effort) para não esperar o cron.
    try {
      await admin.functions.invoke("process-notifications", { body: {} });
    } catch (err) {
      console.warn("[notify-gg-ap] process-notifications invoke falhou (segue no cron):", err);
    }

    return new Response(
      JSON.stringify({ ok: true, sent: rows.length, recipients: rows.length, link_url: linkUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("notify-gg-ap error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});