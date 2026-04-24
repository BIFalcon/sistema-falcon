// Edge function: gera narrativa da Carta ao Investidor (Lovable AI Gateway).
// Recebe { closing_id, letter_id, instruction? }. Sempre cria uma nova versão
// em public.letter_versions e atualiza investor_letters com o último texto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  closing_id: string;
  letter_id: string;
  instruction?: string;
  manual_text?: {
    intro?: string | null;
    market_context?: string | null;
    operational?: string | null;
    financial?: string | null;
    outlook?: string | null;
    closing?: string | null;
  };
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
      { auth: { persistSession: false } },
    );

    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Usuário inválido" }, 401);
    const userId = claimsData.claims.sub as string;

    const { closing_id, letter_id, instruction, manual_text } = (await req.json()) as Body;
    if (!closing_id || !letter_id) return json({ error: "Parâmetros ausentes" }, 400);

    const closing = await supabase.from("closings").select("*").eq("id", closing_id).maybeSingle();
    if (closing.error || !closing.data) return json({ error: "Fechamento não encontrado" }, 404);
    const hotel = await supabase.from("hotels").select("*").eq("id", closing.data.hotel_id).maybeSingle();
    const letter = await supabase.from("investor_letters").select("*").eq("id", letter_id).maybeSingle();
    if (letter.error || !letter.data) return json({ error: "Carta não encontrada" }, 404);

    const nextVersion = (letter.data.ai_version_number ?? 0) + 1;
    if (manual_text) {
      const ver = await supabase.from("letter_versions").insert({
        letter_id,
        closing_id,
        version_number: nextVersion,
        ai_intro: manual_text.intro ?? null,
        ai_market_context: manual_text.market_context ?? null,
        ai_operational: manual_text.operational ?? null,
        ai_financial: manual_text.financial ?? null,
        ai_outlook: manual_text.outlook ?? null,
        ai_closing: manual_text.closing ?? null,
        ai_model: "manual",
        instruction: "Editado manualmente",
        created_by: userId,
      });
      if (ver.error) return json({ error: ver.error.message }, 500);

      const upd = await supabase.from("investor_letters").update({
        ai_intro: manual_text.intro ?? null,
        ai_market_context: manual_text.market_context ?? null,
        ai_operational: manual_text.operational ?? null,
        ai_financial: manual_text.financial ?? null,
        ai_outlook: manual_text.outlook ?? null,
        ai_closing: manual_text.closing ?? null,
        ai_model: "manual",
        ai_generated_at: new Date().toISOString(),
        ai_version_number: nextVersion,
        last_ai_instruction: "Editado manualmente",
        updated_by: userId,
      }).eq("id", letter_id);
      if (upd.error) return json({ error: upd.error.message }, 500);
      return json({ ok: true, model: "manual", version: nextVersion });
    }

    const highlights = await supabase
      .from("letter_highlights")
      .select("title, note")
      .eq("letter_id", letter_id)
      .order("sort_order", { ascending: true });

    const indicators = await supabase
      .from("dre_parsed_lines")
      .select("line_label, line_value, version_number")
      .eq("closing_id", closing_id)
      .eq("line_type", "indicator")
      .order("version_number", { ascending: false });

    const top = indicators.data?.[0]?.version_number;
    const inds = (indicators.data ?? []).filter((r) => r.version_number === top);
    // Separa correntes ([key]) de previous ([prev_key]) e ignora séries mensais
    type Row = { line_label: string; line_value: number | null };
    const cur = new Map<string, Row>();
    const prev = new Map<string, Row>();
    for (const r of inds as Row[]) {
      if (r.line_label.startsWith("[series_")) continue;
      const mp = /^\[prev_(\w+)\]/.exec(r.line_label);
      if (mp) { prev.set(mp[1], r); continue; }
      const m = /^\[(\w+)\]/.exec(r.line_label);
      if (m) cur.set(m[1], r);
    }
    const fmt = (v: number | null) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    const pct = (a: number | null, b: number | null) => {
      if (a == null || b == null || b === 0) return "—";
      const v = ((a - b) / Math.abs(b)) * 100;
      const sign = v >= 0 ? "+" : "";
      return `${sign}${v.toFixed(1)}%`;
    };
    const compRows: string[] = [];
    for (const [k, r] of cur) {
      const p = prev.get(k);
      const lbl = r.line_label.replace(/^\[\w+\]\s*/, "").trim();
      compRows.push(
        `- ${lbl}: ${fmt(r.line_value)} | Ano anterior: ${fmt(p?.line_value ?? null)} | Variação: ${pct(r.line_value, p?.line_value ?? null)}`,
      );
    }
    const indicatorText = compRows.join("\n") || "Indicadores não disponíveis";

    const months = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    const monthName = months[(closing.data.month ?? 1) - 1];

    const highlightsText = (highlights.data ?? []).length > 0
      ? (highlights.data ?? []).map((h, i) => `${i + 1}. ${h.title}${h.note ? ` — ${h.note}` : ""}`).join("\n")
      : "Nenhum destaque informado.";

    const reserveFund = letter.data.reserve_fund != null ? `R$ ${Number(letter.data.reserve_fund).toLocaleString("pt-BR")}` : "—";
    const rps = letter.data.rps_score != null ? String(letter.data.rps_score) : "—";

    const sysPrompt = `Você é redator institucional do hotel "${hotel.data?.name ?? closing.data.hotel_id}" (bandeira ${hotel.data?.brand ?? "—"}).
Escreva em português do Brasil, tom executivo, sóbrio, direto e SUCINTO, voltado a investidores.

REGRAS DE CONTEÚDO (OBRIGATÓRIAS):
- Devolva no MÁXIMO 3 parágrafos curtos (2 a 4 frases cada). intro/operational/outlook.
- O parágrafo "operational" DEVE OBRIGATORIAMENTE incluir comparativos entre o mês atual e o mesmo mês do ano anterior para: Receita Bruta Total, Diária Média (ADR), Taxa de Ocupação e RevPAR — citando o valor absoluto do mês atual e a variação percentual entre parênteses (ex.: "Receita Bruta de R$ 540 mil (+12,4%) frente ao mesmo mês do ano anterior").
- NÃO repita os mesmos números sem adicionar contexto/análise: explique brevemente o que motivou a variação (eventos, sazonalidade, mix, ações da gestão).
- O parágrafo "intro" abre o mês com contexto curto. O parágrafo "outlook" traz perspectivas para os próximos meses.
- Sem markdown, sem listas, sem títulos, sem emojis.

Devolva ESTRITAMENTE um JSON válido com as chaves: intro, market_context, operational, financial, outlook, closing.
Use intro, operational e outlook como os 3 parágrafos principais. market_context, financial e closing devem ser strings vazias.`;

    let userPrompt = `Período: ${monthName} de ${closing.data.year}.

INDICADORES DA DRE:
${indicatorText}

INDICADORES ADICIONAIS:
- Fundo de Reserva: ${reserveFund}
- Nota RPS: ${rps}

DESTAQUES DO MÊS (informados pelo GG/GOP):
${highlightsText}

COMENTÁRIO OPERACIONAL:
${letter.data.operational_comment || "—"}

Gere o JSON.`;

    if (instruction && instruction.trim()) {
      userPrompt += `\n\nINSTRUÇÃO ADICIONAL DO USUÁRIO PARA ESTA REGENERAÇÃO:\n${instruction.trim()}`;
    }

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

    // Salva snapshot no histórico
    const ver = await supabase.from("letter_versions").insert({
      letter_id,
      closing_id,
      version_number: nextVersion,
      ai_intro: parsed.intro ?? null,
      ai_market_context: parsed.market_context ?? null,
      ai_operational: parsed.operational ?? null,
      ai_financial: parsed.financial ?? null,
      ai_outlook: parsed.outlook ?? null,
      ai_closing: parsed.closing ?? null,
      ai_model: MODEL,
      instruction: instruction?.trim() || null,
      created_by: userId,
    });
    if (ver.error) return json({ error: ver.error.message }, 500);

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
        ai_version_number: nextVersion,
        last_ai_instruction: instruction?.trim() || null,
        updated_by: userId,
      })
      .eq("id", letter_id);
    if (upd.error) return json({ error: upd.error.message }, 500);

    return json({ ok: true, model: MODEL, version: nextVersion });
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
