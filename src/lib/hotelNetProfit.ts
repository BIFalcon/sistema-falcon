/**
 * Lucro Líquido por hotel nos Indicadores DRE.
 *
 * Alguns hotéis não trazem o lucro nas linhas padrão: ele é apurado por uma
 * linha específica da DRE, com sinal invertido. A configuração é por
 * `hotel_id` (nunca por nome) e é aplicada na origem dos dados, para que
 * cartões, Histórico, Comparativo, divisor e exportações usem o mesmo valor.
 */
import type { DreLineNode, DreMonthValue, DreSeriesKey } from "@/lib/dreAnalytics";

export interface NetProfitOverride {
  /** Rótulos da linha-fonte, na ordem de preferência. */
  sourceLabels: string[];
  /** true: lucro = -(linha-fonte). */
  invert: boolean;
  hint: string;
}

export const NET_PROFIT_OVERRIDES: Record<string, NetProfitOverride> = {
  // Ibis Budget Recife Jaboatão
  "ibis-budget-recife": {
    sourceLabels: ["(-) Aluguel variável", "Aluguel Variável"],
    invert: true,
    hint: "Lucro líquido apurado pela linha Aluguel Variável (sinal invertido)",
  },
};

export function getNetProfitOverride(hotelId?: string | null): NetProfitOverride | undefined {
  return hotelId ? NET_PROFIT_OVERRIDES[hotelId] : undefined;
}

const clean = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/^\s*\(\s*[=+-]\s*\)\s*/, "").replace(/\s*\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

const NET_RX = [/^lucro liquido/, /^resultado liquido do exerc/, /^resultado liquido$/];
const MARGIN_RX = /^margem liquida/;
const REVENUE_RX = /^(receita bruta total|receita total bruta)$/;

export const isNetProfitLabel = (label: string) => {
  const c = clean(label);
  return NET_RX.some((rx) => rx.test(c)) && !/^margem/.test(c);
};

const KEYS: DreSeriesKey[] = ["current", "budget", "previous"];

/** Reescreve, no dataset de UM hotel, as linhas de lucro e margem líquida. */
export function applyNetProfitOverride(flat: DreLineNode[], hotelId: string): void {
  const cfg = getNetProfitOverride(hotelId);
  if (!cfg) return;
  const wanted = cfg.sourceLabels.map(clean);
  const source = wanted
    .map((w) => flat.find((n) => clean(n.label) === w && !n.id.startsWith("1:")) ?? flat.find((n) => clean(n.label) === w))
    .find(Boolean);
  if (!source) return;
  const sign = cfg.invert ? -1 : 1;
  const net: Record<DreSeriesKey, DreMonthValue[]> = {
    current: source.series.current.map((v) => (v == null ? null : sign * v)),
    budget: source.series.budget.map((v) => (v == null ? null : sign * v)),
    previous: source.series.previous.map((v) => (v == null ? null : sign * v)),
  };
  const rev = flat.find((n) => REVENUE_RX.test(clean(n.label)));
  for (const n of flat) {
    if (isNetProfitLabel(n.label)) {
      for (const k of KEYS) n.series[k] = [...net[k]];
    } else if (MARGIN_RX.test(clean(n.label)) && rev) {
      for (const k of KEYS) {
        const asFraction = n.series[k].every((v) => v == null || Math.abs(v) <= 1);
        n.series[k] = net[k].map((v, m) => {
          const d = rev.series[k][m];
          if (v == null || d == null || d === 0) return null;
          return asFraction ? v / d : (v / d) * 100;
        });
      }
    }
  }
}

/** Mesma regra para uma linha mensal do Histórico (rótulo limpo → valor). */
export function applyNetProfitOverrideToRow(
  row: Map<string, number>,
  hotelId: string | null | undefined,
  netLabels: string[],
  cleanFn: (s: string) => string,
): void {
  const cfg = getNetProfitOverride(hotelId);
  if (!cfg) return;
  const src = cfg.sourceLabels.map(cleanFn).map((c) => row.get(c)).find((v) => v != null);
  if (src == null) return;
  const v = cfg.invert ? -src : src;
  for (const l of netLabels) row.set(cleanFn(l), v);
}
