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

const MODEL = "claude-sonnet-5";

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

    // Authorization: caller must have access to this hotel
    const allowed = await supabase.rpc("is_hotel_allowed", {
      _user_id: userId,
      _hotel_id: closing.data.hotel_id,
    });
    if (allowed.error || allowed.data !== true) {
      return json({ error: "Acesso negado a este hotel" }, 403);
    }

    // Authorization: caller must have a role allowed to author/update letters
    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) return json({ error: "Falha ao verificar permissões" }, 500);
    const roleSet = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
    const canWrite = ["processos", "fernando", "controladoria", "gop", "gg"].some((r) => roleSet.has(r));
    if (!canWrite) return json({ error: "Acesso negado: papel insuficiente" }, 403);

    const hotel = await supabase.from("hotels").select("*").eq("id", closing.data.hotel_id).maybeSingle();
    const letter = await supabase.from("investor_letters").select("*").eq("id", letter_id).maybeSingle();
    if (letter.error || !letter.data) return json({ error: "Carta não encontrada" }, 404);
    if (letter.data.closing_id !== closing_id) {
      return json({ error: "Carta não pertence a este fechamento" }, 403);
    }

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

    // 1) Tenta ler a DRE do próprio fechamento (última versão)
    const topRes = await supabase
      .from("dre_parsed_lines")
      .select("version_number")
      .eq("closing_id", closing_id)
      .order("version_number", { ascending: false })
      .limit(1);
    const top = topRes.data?.[0]?.version_number ?? null;
    type Row = { line_label: string; line_value: number | null };
    let inds: Row[] = [];
    if (top != null) {
      const indicators = await supabase
        .from("dre_parsed_lines")
        .select("line_label, line_value, version_number")
        .eq("closing_id", closing_id)
        .eq("line_type", "indicator")
        .eq("version_number", top)
        .range(0, 9999);
      inds = (indicators.data ?? []) as Row[];
    }
    if (inds.length === 0) {
      return json({ error: "Nenhuma DRE encontrada para este fechamento/mês. Anexe a DRE do mês filtrado antes de gerar a Carta." }, 400);
    }
    const cur = new Map<string, Row>();
    const prev = new Map<string, Row>();
    const source = inds;
    const targetMonth = closing.data.month;
    // 2a) Se estamos usando série do ano, primeiro tentamos reconstruir
    //     valores do mês-alvo via [series_cur_<key>_<mes>] / [series_prev_...].
    for (const r of source) {
      const sc = /^\[series_cur_(.+)_(\d+)\]$/.exec(r.line_label);
      if (sc) {
        const key = sc[1];
        const mo = parseInt(sc[2], 10);
        if (mo === targetMonth && r.line_value != null && r.line_value !== 0) {
          cur.set(key, { line_label: `[${key}]`, line_value: r.line_value });
        }
        continue;
      }
      const sp = /^\[series_prev_(.+)_(\d+)\]$/.exec(r.line_label);
      if (sp) {
        const key = sp[1];
        const mo = parseInt(sp[2], 10);
        if (mo === targetMonth && r.line_value != null && r.line_value !== 0) {
          prev.set(key, { line_label: `[prev_${key}]`, line_value: r.line_value });
        }
        continue;
      }
    }
    // 2b) Fallback pelos indicadores "planos" ([key] / [prev_key]).
    for (const r of source) {
      if (r.line_label.startsWith("[series_")) continue;
      const mp = /^\[prev_(\w+)\]/.exec(r.line_label);
      if (mp) { if (!prev.has(mp[1])) prev.set(mp[1], r); continue; }
      const m = /^\[(\w+)\]/.exec(r.line_label);
      if (m && !cur.has(m[1])) cur.set(m[1], r);
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

    // Contexto estrutural do hotel (respondido pelo GG) — fonte qualitativa de fundo.
    const contexto = await supabase
      .from("hotel_contexto")
      .select("*")
      .eq("hotel_id", closing.data.hotel_id)
      .maybeSingle();
    const ctx = contexto.data as Record<string, string | null> | null;
    const contextoText = ctx?.respondido_em
      ? [
          `- Quem sustenta o hotel hoje: ${ctx.quem_sustenta_hotel || "—"}`,
          `- O que mudou na praça: ${ctx.mudanca_praca || "—"}`,
          `- O que atrapalha o resultado e não aparece em número: ${ctx.atrapalha_operacao || "—"}`,
          `- Quando e por que precisa dar desconto: ${ctx.desconto_frequente || "—"}`,
          `- Prioridade para os próximos 3 meses: ${ctx.prioridade_3_meses || "—"}`,
        ].join("\n")
      : "Nenhum contexto estrutural cadastrado para este hotel.";

    const highlightsText = (highlights.data ?? []).length > 0
      ? (highlights.data ?? []).map((h, i) => `${i + 1}. ${h.title}${h.note ? ` — ${h.note}` : ""}`).join("\n")
      : "Nenhum destaque informado.";

    const reserveFund = letter.data.reserve_fund != null ? `R$ ${Number(letter.data.reserve_fund).toLocaleString("pt-BR")}` : "—";
    const rps = letter.data.rps_score != null ? `${String(letter.data.rps_score).replace(".", ",")}%` : "—";

    const sysPrompt = `Você é redator institucional do hotel "${hotel.data?.name ?? closing.data.hotel_id}" (bandeira ${hotel.data?.brand ?? "—"}).
Escreva em português do Brasil, tom executivo, sóbrio, direto, voltado a investidores.

REGRAS DE CONTEÚDO (OBRIGATÓRIAS):
- Devolva no MÁXIMO 5 parágrafos (3 a 6 frases cada). intro/operational/outlook, mais market_context e closing quando houver conteúdo real pra eles — não force parágrafo vazio só pra preencher.
- O parágrafo "operational" DEVE OBRIGATORIAMENTE incluir comparativos entre o mês atual e o mesmo mês do ano anterior para: Receita Bruta Total, Diária Média (ADR), Taxa de Ocupação e RevPAR — citando o valor absoluto do mês atual e a variação percentual entre parênteses (ex.: "Receita Bruta de R$ 540 mil (+12,4%) frente ao mesmo mês do ano anterior").
- NÃO repita os mesmos números sem adicionar contexto/análise: explique o que motivou a variação.
- **O COMENTÁRIO OPERACIONAL e as OBSERVAÇÕES DOS DESTAQUES DO MÊS, fornecidos abaixo, são a fonte primária de contexto qualitativo — não são material de referência opcional, são para SEREM USADOS de verdade na narrativa.** Sempre que houver conteúdo neles, cite fatos, motivos ou eventos específicos mencionados ali (nomes de ações, parcerias, problemas pontuais, decisões de gestão) em vez de generalizar. Se um número variou e o comentário operacional explica o motivo, esse motivo PRECISA aparecer no texto — não é permitido citar a variação sem a explicação quando ela existir na fonte.
- Só escreva de forma genérica quando o comentário operacional e os destaques estiverem vazios — nesse caso, não invente motivo nenhum, descreva só o que os números mostram.
- O CONTEXTO ESTRUTURAL DO HOTEL (respondido pelo Gerente Geral) descreve a realidade permanente da operação: perfil de demanda, praça, limitações e prioridades. Use-o para INTERPRETAR os números do mês (por que a demanda se comporta assim, por que houve desconto, o que limita o resultado) e para embasar o parágrafo de perspectivas. Não o transcreva nem o cite como "questionário" — incorpore como conhecimento do negócio.
- O parágrafo "intro" abre o mês com contexto curto. O parágrafo "outlook" traz perspectivas para os próximos meses, priorizando o que veio do comentário operacional sobre planos futuros, se houver.
- Sem markdown, sem listas, sem títulos, sem emojis.

Devolva ESTRITAMENTE um JSON válido com as chaves: intro, market_context, operational, financial, outlook, closing.
intro, operational e outlook são obrigatórios. Use market_context e closing SOMENTE quando houver conteúdo real do comentário operacional ou dos destaques do mês que justifique um parágrafo próprio — senão, deixe como string vazia. financial continua sempre vazio (os números já aparecem no Demonstrativo de Resultados, não repetir aqui).`;

    let userPrompt = `Período: ${monthName} de ${closing.data.year}.

INDICADORES DA DRE:
${indicatorText}

INDICADORES ADICIONAIS:
- Fundo de Reserva: ${reserveFund}
- Nota RPS: ${rps}

DESTAQUES DO MÊS (informados pelo GG/GOP):
${highlightsText}

COMENTÁRIO OPERACIONAL (fonte primária de contexto — use os fatos específicos mencionados aqui na narrativa, não só como pano de fundo):
${letter.data.operational_comment || "Nenhum comentário informado — não invente motivos, descreva só o que os números mostram."}

CONTEXTO ESTRUTURAL DO HOTEL (respondido pelo Gerente Geral — realidade permanente da operação, use para interpretar os números):
${contextoText}

Gere o JSON.`;

    if (instruction && instruction.trim()) {
      userPrompt += `\n\nINSTRUÇÃO ADICIONAL DO USUÁRIO PARA ESTA REGENERAÇÃO:\n${instruction.trim()}`;
    }

    const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!aiKey) return json({ error: "ANTHROPIC_API_KEY não configurada" }, 500);

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: sysPrompt,
        messages: [
          { role: "user", content: `${userPrompt}\n\nResponda SOMENTE com o JSON, sem texto antes ou depois.` },
        ],
      }),
    });

    if (aiRes.status === 429) return json({ error: "Limite de uso temporário. Tente novamente em alguns minutos." }, 429);
    if (aiRes.status === 402) return json({ error: "Créditos da IA esgotados. Verifique o saldo na Anthropic Console." }, 402);
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: `IA retornou erro: ${txt.slice(0, 200)}` }, 500);
    }
    const aiJson = await aiRes.json();
    console.error("Anthropic response debug", JSON.stringify(aiJson).slice(0, 2000));
    const textBlock = (aiJson?.content ?? []).find((b: any) => b?.type === "text");
    const rawContent = textBlock?.text ?? "";
    const content = rawContent.replace(/```json\s*|```/g, "").trim();
    if (!content) {
      return json({ error: `Resposta vazia da IA (stop_reason: ${aiJson?.stop_reason ?? "desconhecido"})` }, 500);
    }

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
