// Edge function: enfileira o convite de preenchimento do "Contexto do Hotel"
// para os Gerentes Gerais cujos hotéis ainda não têm contexto respondido.
// Reaproveita a fila lógica `notification_queue`, drenada por
// `process-notifications` -> pgmq `transactional_emails`.

import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://sistema-falcon.lovable.app";
const LINK = "/perfil-hotel/contexto";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Autorização: service-role (cron) ou master autenticado.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  let authorized = false;
  if (token && safeEqual(token, serviceKey)) {
    authorized = true;
  } else if (token) {
    // Verificação criptográfica do JWT via Supabase Auth (nunca confiar em claims decodificadas).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const verifiedUserId = userErr ? null : userData?.user?.id ?? null;
    if (verifiedUserId) {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: isMaster } = await admin.rpc("is_master", { _user_id: verifiedUserId });
      if (isMaster === true) authorized = true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const [ggRoles, contextos, hotels] = await Promise.all([
    supabase.from("user_roles").select("user_id").eq("role", "gg"),
    supabase.from("hotel_contexto").select("hotel_id, respondido_em"),
    supabase.from("hotels").select("id, name"),
  ]);

  if (ggRoles.error || contextos.error || hotels.error) {
    const message = ggRoles.error?.message ?? contextos.error?.message ?? hotels.error?.message;
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ggIds = (ggRoles.data ?? []).map((r) => r.user_id as string);
  if (ggIds.length === 0) {
    return new Response(JSON.stringify({ queued: 0, message: "nenhum GG cadastrado" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const answered = new Set(
    (contextos.data ?? []).filter((c) => c.respondido_em).map((c) => c.hotel_id as string),
  );
  const hotelName = new Map((hotels.data ?? []).map((h) => [h.id as string, h.name as string]));

  const [links, profiles] = await Promise.all([
    supabase.from("user_hotels").select("user_id, hotel_id").in("user_id", ggIds),
    supabase.from("profiles").select("user_id, email, display_name").in("user_id", ggIds),
  ]);
  if (links.error || profiles.error) {
    return new Response(
      JSON.stringify({ error: links.error?.message ?? profiles.error?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const profileById = new Map(
    (profiles.data ?? []).map((p) => [p.user_id as string, p]),
  );

  // Agrupa hotéis pendentes por GG — 1 e-mail por pessoa.
  const pendingByUser = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const hotelId = link.hotel_id as string;
    if (answered.has(hotelId)) continue;
    if (!hotelName.has(hotelId)) continue;
    const list = pendingByUser.get(link.user_id as string) ?? [];
    list.push(hotelId);
    pendingByUser.set(link.user_id as string, list);
  }

  const rows: Record<string, unknown>[] = [];
  for (const [userId, hotelIds] of pendingByUser) {
    const profile = profileById.get(userId);
    const email = (profile?.email as string | undefined)?.trim();
    if (!email) continue;
    const names = hotelIds.map((id) => hotelName.get(id)!).join(", ");
    const firstName = String(profile?.display_name ?? "").split(" ")[0] || "Olá";
    rows.push({
      event: "hotel_contexto_request",
      hotel_id: hotelIds[0],
      recipient_user_id: userId,
      recipient_email: email,
      recipient_role: "gg",
      subject: `Contexto do hotel — ${names}`,
      body_md: [
        `Olá, ${firstName}!`,
        "",
        `Precisamos de 5 respostas rápidas sobre o **${names}**. São informações que só a gestão do hotel sabe (demanda, praça, dificuldades operacionais e prioridades) e que melhoram bastante a qualidade da Carta ao Investidor e das análises de IA.`,
        "",
        `Leva **menos de 5 minutos** e dá pra salvar como rascunho: [Responder agora](${LINK})`,
        "",
        "Obrigado!",
      ].join("\n"),
      link_url: LINK,
      status: "pending",
      payload: { hotel_ids: hotelIds, base_url: APP_BASE_URL },
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("notification_queue").insert(rows);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ queued: rows.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
