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
  /** 6 meses (do mês atual − 5 ao mês atual) — ano corrente */
  current: MonthDatum[];
  /** mesmos 6 meses do ano anterior */
  previous: MonthDatum[];
}

const KEYS: IndicatorKey[] = ["ocupacao", "adr", "receita_bruta_total"];

function emptyDatum(month: number): MonthDatum {
  return { month, ocupacao: null, adr: null, receita_bruta_total: null };
}

async function fetchIndicatorsFor(
  hotelId: string,
  year: number,
  month: number,
): Promise<Partial<Record<IndicatorKey, number | null>>> {
  const { data: closing } = await supabase
    .from("closings")
    .select("id")
    .eq("hotel_id", hotelId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (!closing?.id) return {};
  const { data: lines } = await supabase
    .from("dre_parsed_lines")
    .select("line_label, line_value, version_number")
    .eq("closing_id", closing.id)
    .eq("line_type", "indicator")
    .order("version_number", { ascending: false });
  if (!lines || lines.length === 0) return {};
  const top = lines[0].version_number;
  const out: Partial<Record<IndicatorKey, number | null>> = {};
  for (const r of lines.filter((l) => l.version_number === top)) {
    const m = /^\[(\w+)\]/.exec(r.line_label);
    if (m && KEYS.includes(m[1] as IndicatorKey)) {
      out[m[1] as IndicatorKey] = r.line_value;
    }
  }
  return out;
}

function rangeMonths(year: number, month: number): { y: number; m: number }[] {
  const arr: { y: number; m: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 5; i >= 0; i--) {
    arr.unshift({ y, m });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  // restaurar ordem cronológica
  return arr.reverse().reverse();
}

export async function fetchLetterHistory(
  hotelId: string,
  year: number,
  month: number,
): Promise<LetterHistory> {
  const months = rangeMonths(year, month);

  const current: MonthDatum[] = [];
  const previous: MonthDatum[] = [];

  for (const { y, m } of months) {
    const cur = await fetchIndicatorsFor(hotelId, y, m);
    const prev = await fetchIndicatorsFor(hotelId, y - 1, m);
    current.push({
      month: m,
      ocupacao: cur.ocupacao ?? null,
      adr: cur.adr ?? null,
      receita_bruta_total: cur.receita_bruta_total ?? null,
    });
    previous.push({
      month: m,
      ocupacao: prev.ocupacao ?? null,
      adr: prev.adr ?? null,
      receita_bruta_total: prev.receita_bruta_total ?? null,
    });
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
