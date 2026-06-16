/**
 * Busca histórico de 6 meses (mês atual e anteriores) para o mesmo hotel,
 * extraindo Ocupação, ADR e Receita Bruta Total — tanto do ano corrente
 * quanto do ano anterior — para alimentar os gráficos da Carta.
 */
import { supabase } from "@/integrations/supabase/client";
import type { IndicatorKey } from "@/lib/dreParser";

export interface MonthDatum {
  month: number; // 1-12
  ocupacao: number | null;          // em fração 0-1 ou %
  adr: number | null;
  receita_bruta_total: number | null;
}

export interface LetterHistory {
  /** 12 meses Jan–Dez do ano da DRE corrente */
  current: MonthDatum[];
  /** 12 meses Jan–Dez do ano anterior (lidos da aba "ANO ANTERIOR") */
  previous: MonthDatum[];
}

const KEYS: IndicatorKey[] = ["ocupacao", "adr", "receita_bruta_total"];

function emptyYear(): MonthDatum[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, ocupacao: null, adr: null, receita_bruta_total: null,
  }));
}

/**
 * Carrega séries Jan–Dez (current = ano da DRE; previous = aba "ANO ANTERIOR")
 * a partir das linhas persistidas em `dre_parsed_lines` com prefixo
 * `[series_<cur|prev>_<key>_<mes>]`. Quando essas linhas não existem (ex.: DREs
 * antigos, parser legacy), retorna 12 slots vazios.
 */
export async function fetchLetterHistory(
  hotelId: string,
  year: number,
  month: number,
): Promise<LetterHistory> {
  const current = emptyYear();
  const previous = emptyYear();

  // Pega o closing do mês corrente (que carrega a DRE com séries persistidas)
  const { data: closing } = await supabase
    .from("closings")
    .select("id")
    .eq("hotel_id", hotelId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (!closing?.id) return { current, previous };

  // Descobre a versão mais recente da DRE deste closing
  const { data: latest } = await supabase
    .from("dre_parsed_lines")
    .select("version_number")
    .eq("closing_id", closing.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const top = latest?.version_number;
  if (top == null) return { current, previous };

  // Busca apenas as linhas de série da última versão (evita o limite default
  // de 1000 linhas do PostgREST com DREs grandes, que estava deixando os
  // gráficos da Carta vazios).
  const { data: lines } = await supabase
    .from("dre_parsed_lines")
    .select("line_label, line_value, version_number")
    .eq("closing_id", closing.id)
    .eq("version_number", top)
    .eq("line_type", "indicator")
    .like("line_label", "[series_%")
    .limit(2000);
  if (!lines || lines.length === 0) return { current, previous };

  const rx = /^\[series_(cur|prev)_(\w+)_(\d{1,2})\]$/;
  for (const r of lines) {
    const m = rx.exec(r.line_label);
    if (!m) continue;
    const scope = m[1] as "cur" | "prev";
    const key = m[2] as IndicatorKey;
    const mo = Number(m[3]);
    if (!KEYS.includes(key) || mo < 1 || mo > 12) continue;
    const target = scope === "cur" ? current : previous;
    (target[mo - 1] as unknown as Record<string, number | null>)[key] = r.line_value;
  }
  // Guarda contra outliers de parser: alguns templates "ANO ANTERIOR" têm
  // colunas "Acumulado/Total" alinhadas ao mês, fazendo o parser pegar um
  // valor 5-10x maior que os demais. Anulamos qualquer mês cujo valor seja
  // > 4× a mediana dos outros valores não-zero da mesma série, evitando que
  // o gráfico fique sem escala por causa de um único ponto absurdo.
  const scrubOutliers = (series: MonthDatum[]) => {
    for (const key of KEYS) {
      const values = series
        .map((d, i) => ({ i, v: (d as unknown as Record<string, number | null>)[key] }))
        .filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v) && p.v !== 0);
      if (values.length < 4) continue;
      const sorted = [...values].map((p) => p.v).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median <= 0) continue;
      for (const p of values) {
        if (p.v > median * 4) {
          (series[p.i] as unknown as Record<string, number | null>)[key] = null;
        }
      }
    }
  };
  scrubOutliers(current);
  scrubOutliers(previous);

  // ───── Ajustes específicos por hotel ─────
  // Arcoverde (ibis-arcoverde) abriu em ago/2025 — qualquer mês anterior na
  // aba "ANO ANTERIOR" é resíduo de fórmula e contamina os gráficos.
  // Também removemos junho no gráfico, para não exibir uma coluna sem
  // comparativo do ano anterior nesse hotel.
  if (hotelId === "ibis-arcoverde") {
    // Ano anterior: zera Jan..Jul (índices 0..6) — abriu em ago/2025
    for (let i = 0; i < 7; i++) {
      previous[i].ocupacao = null;
      previous[i].adr = null;
      previous[i].receita_bruta_total = null;
    }
    // Junho sem comparativo: também zera no ano anterior
    // (o filtro de "mês solitário" é feito no letterPdf removendo junho).
    previous[5].ocupacao = null;
    previous[5].adr = null;
    previous[5].receita_bruta_total = null;
  }

  return { current, previous };
}

/** Lê linhas DRE (todas) da última versão para a tabela do PDF.
 *  Inclui também o indicador `[distribuicao_por_uh]` como fallback, pois em
 *  uploads antigos a linha "Por UH" pode não ter sido persistida com
 *  `line_type='line'` (ficava no fim da DRE, fora do limite antigo de 200
 *  linhas). O parser sempre persiste o indicador, então usamos ele como
 *  rede de segurança para a tabela DRE da Carta.
 */
export async function fetchDreLines(closingId: string): Promise<{ label: string; value: number | null }[]> {
  const { data: latest } = await supabase
    .from("dre_parsed_lines")
    .select("version_number")
    .eq("closing_id", closingId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const top = latest?.version_number;
  if (top == null) return [];
  const { data: topRows } = await supabase
    .from("dre_parsed_lines")
    .select("line_label, line_value, line_type")
    .eq("closing_id", closingId)
    .eq("version_number", top)
    .limit(5000);
  if (!topRows || topRows.length === 0) return [];
  const out: { label: string; value: number | null }[] = topRows
    .filter((r) => r.line_type === "line")
    .map((r) => ({ label: r.line_label, value: r.line_value }));
  // Fallback: garante que "Por UH" apareça mesmo quando só foi salvo como
  // indicador (`[distribuicao_por_uh] Por UH`).
  const hasPorUh = out.some((l) => /^por\s+uh$/i.test(l.label));
  if (!hasPorUh) {
    const distInd = topRows.find(
      (r) => r.line_type === "indicator" && /^\[distribuicao_por_uh\]/i.test(r.line_label),
    );
    if (distInd) {
      const cleanLabel = distInd.line_label.replace(/^\[\w+\]\s*/, "").trim() || "Por UH";
      out.push({ label: cleanLabel, value: distInd.line_value });
    }
  }
  return out;
}
