/**
 * Estimador de distribuição com base na DRE recém-parseada + histórico do hotel.
 *
 * Regra (acordada com o usuário):
 * - Para CADA indicador-chave da DRE atual:
 *   - Se o valor existe e é diferente de zero → usa valor real.
 *   - Se está vazio (null) ou zero → estima usando média dos últimos 3 meses
 *     fechados (status_dre = 'aprovado') do mesmo hotel. Se houver menos
 *     histórico, usa o que tiver (1 ou 2 meses). Se não houver nenhum,
 *     marca como `no_history`.
 * - O valor de "distribuição estimada" é o `lucro_liquido` resultante
 *   (real ou estimado). Se for negativo ou zero, distribuição = 0.
 */
import type { IndicatorKey, ParsedDre } from "./dreParser";
import { INDICATOR_LABELS } from "./dreParser";

export type LineSource = "real" | "estimated" | "no_history";

export interface EstimatedLine {
  key: IndicatorKey;
  label: string;
  value: number | null;
  source: LineSource;
  history_months_used?: number;
}

export interface DistributionEstimate {
  estimated_distribution: number;
  lucro_liquido_used: number | null;
  lucro_liquido_source: LineSource;
  lines: EstimatedLine[];
  any_estimated: boolean;
}

/**
 * Histórico simplificado: para cada mês anterior fechado, mapa indicator → valor.
 * O caller (hook de upload) busca essas linhas em `dre_parsed_lines` filtrando
 * fechamentos do mesmo hotel com status_dre = 'aprovado'.
 */
export type HistoryEntry = Partial<Record<IndicatorKey, number>>;

const KEYS_TO_EVALUATE: IndicatorKey[] = [
  "ocupacao",
  "adr",
  "revpar",
  "roomnights",
  "uhs_total",
  "uhs_disponiveis",
  "receita_hospedagem",
  "receita_ab",
  "receita_bruta_total",
  "receita_liquida_total",
  "gop",
  "ebitda",
  "lucro_liquido",
];

function isUsable(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function averageOfHistory(
  history: HistoryEntry[],
  key: IndicatorKey,
): { value: number | null; monthsUsed: number } {
  const vals = history
    .map((h) => h[key])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return { value: null, monthsUsed: 0 };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { value: avg, monthsUsed: vals.length };
}

export function estimateDistribution(
  parsed: ParsedDre,
  history: HistoryEntry[],
): DistributionEstimate {
  const lines: EstimatedLine[] = [];
  let anyEstimated = false;

  for (const key of KEYS_TO_EVALUATE) {
    const hit = parsed.indicators[key];
    const realValue = hit?.value ?? null;
    if (isUsable(realValue)) {
      lines.push({
        key,
        label: INDICATOR_LABELS[key],
        value: realValue,
        source: "real",
      });
    } else if (history.length > 0) {
      const { value, monthsUsed } = averageOfHistory(history, key);
      if (value != null) {
        anyEstimated = true;
        lines.push({
          key,
          label: INDICATOR_LABELS[key],
          value,
          source: "estimated",
          history_months_used: monthsUsed,
        });
      } else {
        lines.push({
          key,
          label: INDICATOR_LABELS[key],
          value: null,
          source: "no_history",
        });
      }
    } else {
      lines.push({
        key,
        label: INDICATOR_LABELS[key],
        value: null,
        source: "no_history",
      });
    }
  }

  const lucroLine = lines.find((l) => l.key === "lucro_liquido");
  const lucro = lucroLine?.value ?? null;
  const distribution = isUsable(lucro) && lucro > 0 ? lucro : 0;

  return {
    estimated_distribution: distribution,
    lucro_liquido_used: lucro,
    lucro_liquido_source: lucroLine?.source ?? "no_history",
    lines,
    any_estimated: anyEstimated,
  };
}

/**
 * Converte linhas parseadas (vindas de `dre_parsed_lines` com prefixo `[key]`)
 * de um fechamento aprovado em um HistoryEntry.
 */
export function buildHistoryEntry(
  rows: { line_label: string; line_value: number | null }[],
): HistoryEntry {
  const entry: HistoryEntry = {};
  for (const r of rows) {
    const m = r.line_label.match(/^\[([a-z_]+)\]/);
    if (!m) continue;
    const key = m[1] as IndicatorKey;
    if (typeof r.line_value === "number" && Number.isFinite(r.line_value)) {
      entry[key] = r.line_value;
    }
  }
  return entry;
}