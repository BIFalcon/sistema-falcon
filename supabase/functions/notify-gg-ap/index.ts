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
    const [{ data: hotel }, { data: entries }, { data: ggs }] = await Promise.all([
      admin.from("hotels").select("id,name").eq("id", hotelId).single(),
      admin.from("ap_entries").select("*").eq("hotel_id", hotelId).in("id", entryIds),
      admin.rpc("users_with_role_for_hotel", { _role: "gg", _hotel_id: hotelId }),
    ]);

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ error: "no_entries" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipients = (ggs ?? []) as { user_id: string; email: string; display_name: string | null }[];
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, recipients: 0, warning: "no_gg_for_hotel" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Montar corpo do e-mail
    const total = entries.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const lines = entries
      .sort((a: any, b: any) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
      .map((e: any) => {
        const issues: string[] = [];
        if (e.gg_approval !== "approved") issues.push("sem aprovação");
        if (!e.primary_document_id) issues.push("sem documento");
        if (e.omie_situation?.toLowerCase().includes("atras")) issues.push("atrasado");
        return `- **${e.supplier}** — Doc ${e.document_number ?? "—"} — Venc. ${fmtDate(e.due_date)} — ${fmtBRL(Number(e.amount))}` +
          (issues.length ? `  \n  _Pendências: ${issues.join(", ")}_` : "");
      });

    const subject = `[${hotel?.name ?? "Hotel"}] Contas a Pagar — ${entries.length} pendência(s) aguardando você`;
    const bodyMd =
      `Olá,\n\nVocê tem **${entries.length} lançamento(s)** com pendências em **${hotel?.name ?? "seu hotel"}** ` +
      `totalizando **${fmtBRL(total)}**:\n\n` +
      lines.join("\n") +
      `\n\nAcesse o Falcon para aprovar ou recusar.\n\n[Abrir Contas a Pagar](/financeiro/contas-pagar)`;

    const linkUrl = `/financeiro/contas-pagar`;

    // Inserir na fila (usa enqueue_workflow_notification existente)
    const recipientsJson = recipients.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      role: "gg",
    }));

    // closing_id é NOT NULL na tabela; usamos um placeholder buscando o último closing do hotel
    const { data: anyClosing } = await admin
      .from("closings")
      .select("id")
      .eq("hotel_id", hotelId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!anyClosing) {
      return new Response(JSON.stringify({ error: "no_closing_anchor" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: enqErr } = await admin.rpc("enqueue_workflow_notification", {
      _event: "ap_pendencies_to_gg",
      _closing_id: anyClosing.id,
      _hotel_id: hotelId,
      _recipients: recipientsJson,
      _subject: subject,
      _body_md: bodyMd,
      _link_url: linkUrl,
      _payload: { entry_ids: entryIds, total },
    });
    if (enqErr) throw enqErr;

    return new Response(JSON.stringify({
      ok: true,
      sent: inserted ?? recipients.length,
      recipients: recipients.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("notify-gg-ap error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});