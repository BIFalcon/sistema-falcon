// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { sendLovableEmail } from "npm:@lovable.dev/email-js";

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

function buildEmailHtml(md: string, baseUrl: string): string {
  // Conversão simples de markdown para HTML.
  const html = md
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(.+?)\]\((\/[^)]+)\)/g, `<a href="${baseUrl}$2">$1</a>`)
    .replace(/\[(.+?)\]\((.+?)\)/g, `<a href="$2">$1</a>`)
    .replace(/\n/g, "<br/>");
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;max-width:640px;margin:0 auto;padding:24px;">
  <div style="font-size:14px;">${html}</div>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
  <p style="font-size:12px;color:#777;">Sistema Falcon Hotels</p>
</body></html>`;
}

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
    const recipients = [
      ...ggRecipients,
      ...extraEmails.map((email) => ({ user_id: null as unknown as string, email, display_name: null })),
    ];
    if (recipients.length === 0) {
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
      (customMessage ? `\n\n**Mensagem:**\n${customMessage}\n` : "") +
      `\n\n${cta}\n\n[Abrir Contas a Pagar](/financeiro/contas-pagar)`;

    const linkUrl = `/financeiro/contas-pagar`;

    // Envia e-mail diretamente para cada destinatário (sem depender de closing_id)
    const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://sistema-falcon.lovable.app";
    let sent = 0;
    for (const r of recipients) {
      try {
        await sendLovableEmail({
          from: "Sistema Falcon <notificacoes@notify.falconhoteis.com.br>",
          to: r.email,
          subject,
          html: buildEmailHtml(bodyMd, APP_URL),
        });
        sent++;
      } catch (err) {
        console.error("[notify-gg-ap] falha ao enviar para", r.email, err);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, recipients: recipients.length, link_url: linkUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("notify-gg-ap error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});