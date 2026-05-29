// deno-lint-ignore-file no-explicit-any
// Notifica os GGs dos hotéis com novos registros de A Faturar.
// Disparada automaticamente após upload (parse-ar-report) e também
// pode ser chamada manualmente passando { hotel_id }.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Endpoint interno: aceita apenas chamadas com a service role key
    // (usado por parse-ar-report e por jobs administrativos).
    const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!token || token !== serviceKey) {
      return new Response(
        JSON.stringify({ error: "forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const uploadId: string | undefined = body?.upload_id;
    const targetHotelId: string | undefined = body?.hotel_id;

    // Carrega os registros relevantes (do upload, ou pendentes do hotel).
    let q = admin
      .from("ar_to_invoice_entries")
      .select("hotel_id, amount, ar_open, gg_status");
    if (uploadId) q = q.eq("upload_id", uploadId);
    else if (targetHotelId) q = q.eq("hotel_id", targetHotelId).eq("gg_status", "pendente");
    else q = q.eq("gg_status", "pendente");

    const { data: entries, error } = await q;
    if (error) throw error;

    const grouped = new Map<string, { count: number; total: number }>();
    for (const e of entries ?? []) {
      if (!e.hotel_id) continue;
      const cur = grouped.get(e.hotel_id) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(e.ar_open ?? e.amount ?? 0);
      grouped.set(e.hotel_id, cur);
    }

    const { data: hotels } = await admin.from("hotels").select("id, name");
    const hotelMap = new Map<string, string>(
      (hotels ?? []).map((h: any) => [h.id, h.name]),
    );

    let notified = 0;
    for (const [hotelId, info] of grouped.entries()) {
      if (info.count === 0) continue;
      const { data: ggs } = await admin.rpc("users_with_role_for_hotel", {
        _role: "gg",
        _hotel_id: hotelId,
      });
      if (!ggs?.length) continue;
      const recipients = ggs
        .filter((g: any) => g.user_id && g.email)
        .map((g: any) => ({ user_id: g.user_id, email: g.email, role: "gg" }));
      if (!recipients.length) continue;

      const hotelName = hotelMap.get(hotelId) ?? hotelId;
      const link = `/financeiro/contas-receber?hotel=${encodeURIComponent(hotelId)}&tab=to-invoice`;
      const subject = `[${hotelName}] ${info.count} novo(s) registro(s) de A Faturar — ${brl(info.total)}`;
      const md =
        `Foi importado um novo relatório de **A Faturar** para **${hotelName}**.\n\n` +
        `Foram identificados **${info.count} registro(s)** totalizando **${brl(info.total)}**.\n\n` +
        `Acesse o sistema e marque cada registro como **Faturado** ou **Não faturado**, ` +
        `incluindo observação quando aplicável.\n\n` +
        `[Abrir A Faturar do hotel](${link})`;

      await admin.rpc("enqueue_workflow_notification", {
        _event: "ar_to_invoice_pending_to_gg",
        _closing_id: "00000000-0000-0000-0000-000000000000",
        _hotel_id: hotelId,
        _recipients: recipients,
        _subject: subject,
        _body_md: md,
        _link_url: link,
        _payload: { upload_id: uploadId, count: info.count, total: info.total },
      });
      notified++;
    }

    return new Response(
      JSON.stringify({ ok: true, hotels_notified: notified }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("notify-gg-to-invoice error", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});