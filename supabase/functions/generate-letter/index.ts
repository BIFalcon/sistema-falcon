// Edge function: gera a narrativa da Carta ao Investidor usando Lovable AI Gateway.
// Recebe { closing_id, letter_id }. Carrega highlights + indicadores DRE
// e devolve textos por seção, salvos diretamente em investor_letters.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  closing_id: string;
  letter_id: string;
}

const MODEL = "google/gemini-2.5-flash";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    // Valida o JWT via getClaims() (suporta as novas chaves ES256/HS256 do Supabase).
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: "Usuário inválido" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const { closing_id, letter_id } = (await req.json()) as Body;
    if (!closing_id || !letter_id) return json({ error: "Parâmetros ausentes" }, 400);

    // Carrega contexto
    const closing = await supabase.from("closings").select("*").eq("id", closing_id).maybeSingle();
    if (closing.error || !closing.data) return json({ error: "Fechamento não encontrado" }, 404);
    const hotel = await supabase.from("hotels").select("*").eq("id", closing.data.hotel_id).maybeSingle();
    const letter = await supabase.from("investor_letters").select("*").eq("id", letter_id).maybeSingle();
    if (letter.error || !letter.data) return json({ error: "Carta não encontrada" }, 404);
    const indicators = await supabase
      .from("dre_parsed_lines")
      .select("line_label, line_value, version_number")
      .eq("closing_id", closing_id)
      .eq("line_type", "indicator")
      .order("version_number", { ascending: false });

    const top = indicators.data?.[0]?.version_number;
    const inds = (indicators.data ?? []).filter((r) => r.version_number === top);
    const indicatorText = inds
      .map((i) => `- ${i.line_label}: ${i.line_value}`)
      .join("\n") || "Indicadores não disponíveis";

    const months = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    const monthName = months[(closing.data.month ?? 1) - 1];

    const sysPrompt = `Você é redator institucional do hotel "${hotel.data?.name ?? closing.data.hotel_id}" (bandeira ${hotel.data?.brand ?? "—"}). Escreva em português do Brasil, tom executivo, sóbrio e objetivo, voltado a investidores. Não invente números — use exclusivamente o que está nos indicadores e nos destaques fornecidos. Devolva ESTRITAMENTE um JSON válido com as chaves: intro, market_context, operational, financial, outlook, closing. Cada valor é um parágrafo de 3 a 5 frases (sem markdown, sem listas).`;

    const userPrompt = `Período: ${monthName} de ${closing.data.year}.\n\nINDICADORES DA DRE:\n${indicatorText}\n\nDESTAQUES DO GERENTE (use como base, parafraseie quando útil):\n- Mercado: ${letter.data.highlight_market || "—"}\n- Operações: ${letter.data.highlight_operations || "—"}\n- Receitas: ${letter.data.highlight_revenue || "—"}\n- Custos: ${letter.data.highlight_costs || "—"}\n- Perspectivas: ${letter.data.highlight_outlook || "—"}\n- Notas: ${letter.data.custom_notes || "—"}\n\nGere o JSON.`;

    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!aiKey) return json({ error: "LOVABLE_API_KEY não configurada" }, 500);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) return json({ error: "Limite de uso temporário. Tente novamente em alguns minutos." }, 429);
    if (aiRes.status === 402) return json({ error: "Créditos da IA esgotados. Adicione créditos no workspace Lovable." }, 402);
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: `IA retornou erro: ${txt.slice(0, 200)}` }, 500);
    }
    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content;
    if (!content) return json({ error: "Resposta vazia da IA" }, 500);

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ error: "IA retornou JSON inválido" }, 500);
    }

    const upd = await supabase
      .from("investor_letters")
      .update({
        ai_intro: parsed.intro ?? null,
        ai_market_context: parsed.market_context ?? null,
        ai_operational: parsed.operational ?? null,
        ai_financial: parsed.financial ?? null,
        ai_outlook: parsed.outlook ?? null,
        ai_closing: parsed.closing ?? null,
        ai_model: MODEL,
        ai_generated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq("id", letter_id);
    if (upd.error) return json({ error: upd.error.message }, 500);

    return json({ ok: true, model: MODEL });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}