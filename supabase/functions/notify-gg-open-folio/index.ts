// deno-lint-ignore-file no-explicit-any
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
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const uploadId: string | undefined = body?.upload_id;
    const targetHotelId: string | undefined = body?.hotel_id;

    // Busca folios SEM justificativa (confirmation_numbers sem nota)
    const { data: justifiedNums } = await admin
      .from("ar_open_folio_notes")
      .select("confirmation_number, hotel_id");
    const justifiedSet = new Set(
      (justifiedNums ?? []).map((n: any) => `${n.hotel_id}|${n.confirmation_number}`)
    );

    // Agrega folios em aberto por hotel
    let q = admin
      .from("ar_open_folio_entries")
      .select("hotel_id, balance, confirmation_number")
      .is("archived_at", null);
    if (targetHotelId) q = q.eq("hotel_id", targetHotelId);
    const { data: allEntries, error } = await q;
    if (error) throw error;

    // Filtra apenas os SEM justificativa
    const entries = (allEntries ?? []).filter((e: any) =>
      !justifiedSet.has(`${e.hotel_id}|${e.confirmation_number}`)
    );

    if (!entries.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "Todos os folios já estão justificados" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const grouped = new Map<string, { count: number; total: number }>();
    for (const e of entries ?? []) {
      if (!e.hotel_id) continue;
      const cur = grouped.get(e.hotel_id) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(e.balance ?? 0);
      grouped.set(e.hotel_id, cur);
    }

    const { data: hotels } = await admin.from("hotels").select("id, name");
    const hotelMap = new Map<string, string>(
      (hotels ?? []).map((h: any) => [h.id, h.name]),
    );

    let total = 0;
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
      const link = `/financeiro/contas-receber?hotel=${encodeURIComponent(hotelId)}&tab=open-folio`;
      const subject = `[${hotelName}] ${info.count} folio(s) em aberto — ${brl(info.total)}`;
      const body = `Foi importado um novo relatório de **Open Folio** e existem **${info.count} folio(s)** em aberto em **${hotelName}**, totalizando **${brl(info.total)}**.\n\n` +
        `Você tem **48 horas** para acessar o sistema e justificar cada folio.\n\n` +
        `[Abrir Open Folio do hotel](${link})`;

      await admin.rpc("enqueue_workflow_notification", {
        _event: "open_folio_pendencies_to_gg",
        _closing_id: "00000000-0000-0000-0000-000000000000",
        _hotel_id: hotelId,
        _recipients: recipients,
        _subject: subject,
        _body_md: body,
        _link_url: link,
        _payload: { upload_id: uploadId, count: info.count, total: info.total },
      });
      total++;
    }

    // Verifica folios cuja data prevista de faturamento já passou e ainda estão abertos
    const today = new Date().toISOString().slice(0, 10);
    const { data: overdueNotes } = await admin
      .from("ar_open_folio_notes")
      .select("confirmation_number, hotel_id, expected_payment_date")
      .lt("expected_payment_date", today)
      .not("expected_payment_date", "is", null);

    for (const note of overdueNotes ?? []) {
      // Verifica se o folio ainda está em aberto
      const { data: stillOpen } = await admin
        .from("ar_open_folio_entries")
        .select("id, balance, first_name, last_name")
        .eq("hotel_id", note.hotel_id)
        .eq("confirmation_number", note.confirmation_number)
        .is("archived_at", null)
        .maybeSingle();
      if (!stillOpen) continue;

      const hotelName = hotelMap.get(note.hotel_id) ?? note.hotel_id;

      // Notifica GG
      const { data: ggs } = await admin.rpc("users_with_role_for_hotel", {
        _role: "gg", _hotel_id: note.hotel_id,
      });
      const ggRecipients = (ggs ?? [])
        .filter((g: any) => g.user_id && g.email)
        .map((g: any) => ({ user_id: g.user_id, email: g.email, role: "gg" }));

      // Notifica Financeiro
      const { data: fins } = await admin.rpc("users_with_role_global", {
        _role: "financeiro",
      });
      const finRecipients = (fins ?? [])
        .filter((f: any) => f.user_id && f.email)
        .map((f: any) => ({ user_id: f.user_id, email: f.email, role: "financeiro" }));

      const recipients = [...ggRecipients, ...finRecipients];
      if (!recipients.length) continue;

      const subject = `[${hotelName}] Folio vencido — ${stillOpen.first_name} ${stillOpen.last_name}`;
      const body = `O folio de **${stillOpen.first_name} ${stillOpen.last_name}** ` +
        `(${note.confirmation_number}) em **${hotelName}** passou da data prevista ` +
        `de faturamento (${note.expected_payment_date}) e ainda está em aberto.\n\n` +
        `**Valor:** ${brl(Number(stillOpen.balance))}\n\n` +
        `[Ver Open Folio](/financeiro/contas-receber)`;

      await admin.from("notification_queue").insert(
        recipients.map((r: any) => ({
          event: "open_folio_overdue",
          hotel_id: note.hotel_id,
          recipient_user_id: r.user_id,
          recipient_email: r.email,
          recipient_role: r.role,
          subject,
          body_md: body,
          link_url: "/financeiro/contas-receber",
          payload: { confirmation_number: note.confirmation_number },
        }))
      );
    }

    return new Response(JSON.stringify({ ok: true, hotels_notified: total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("notify-gg-open-folio error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});