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

  const { data: lines } = await supabase
    .from("dre_parsed_lines")
    .select("line_label, line_value, version_number")
    .eq("closing_id", closing.id)
    .eq("line_type", "indicator")
    .order("version_number", { ascending: false });
  if (!lines || lines.length === 0) return { current, previous };
  const top = lines[0].version_number;

  const rx = /^\[series_(cur|prev)_(\w+)_(\d{1,2})\]$/;
  for (const r of lines.filter((l) => l.version_number === top)) {
    const m = rx.exec(r.line_label);
    if (!m) continue;
    const scope = m[1] as "cur" | "prev";
    const key = m[2] as IndicatorKey;
    const mo = Number(m[3]);
    if (!KEYS.includes(key) || mo < 1 || mo > 12) continue;
    const target = scope === "cur" ? current : previous;
    (target[mo - 1] as unknown as Record<string, number | null>)[key] = r.line_value;
  }
  return { current, previous };
}

/** Lê linhas DRE (todas) da última versão para a tabela do PDF. */
export async function fetchDreLines(closingId: string): Promise<{ label: string; value: number | null }[]> {
  const { data } = await supabase
    .from("dre_parsed_lines")
    .select("line_label, line_value, line_type, version_number")
    .eq("closing_id", closingId)
    .order("version_number", { ascending: false });
  if (!data || data.length === 0) return [];
  const top = data[0].version_number;
  return data
    .filter((r) => r.version_number === top && r.line_type === "line")
    .map((r) => ({ label: r.line_label, value: r.line_value }));
}
