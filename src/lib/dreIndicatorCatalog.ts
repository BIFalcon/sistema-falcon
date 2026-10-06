/**
 * Catálogo de indicadores da DRE. Todo indicador é uma razão:
 * soma(numerador nos meses) ÷ soma(denominador nos meses) × escala.
 * Nunca média de valores mensais.
 */
import type { DreLineNode, DreMonthValue, DreSeriesKey } from "@/lib/dreAnalytics";

export const NET_PROFIT_LABELS = [
  "Lucro Líquido / Prejuízo do Exercício",
  "Lucro Líquido",
  "Resultado Líquido do Exercício",
  "Resultado Líquido",
];
export const REVENUE_LABELS = ["Receita Bruta Total", "RECEITA BRUTA TOTAL", "Receita Total Bruta"];
export const LODGING_LABELS = [
  "Receita de Hospedagem", "Receitas de Hospedagem", "Receita Hospedagem",
  "Receita de Diárias", "Receita de Hospedagens", "Hospedagem",
];
export const OCCUPIED_LABELS = ["Apartamentos Ocupados", "Apartamentos ocupados", "Room Nights", "Roomnights", "UHs Ocupadas"];
export const AVAILABLE_LABELS = [
  "Número de apartamentos disponíveis", "Numero de apartamentos disponiveis",
  "Apartamentos Disponíveis", "UHs Disponíveis", "Quartos Disponíveis",
];
export const GOP_LABELS = ["Resultado Operacional Bruto (GOP)", "Lucro Operacional Bruto (GOP)", "GOP", "Resultado Operacional Bruto"];
export const GUESTS_LABELS = ["Número de Hóspedes", "Número de hóspedes", "Números de Hóspedes"];
export const AB_REVENUE_LABELS = ["Receita Bruta A&B", "Receitas de Alimentos e Bebidas (A&B)", "Receitas A&B", "Receita de A&B", "Receita A&B"];
export const LABOR_LABELS = ["Despesas com Pessoal"];
export const CMV_LABELS = ["(-) Custo das Mercadorias Vendidas", "(-) Custo com Mercadorias Vendidas", "Custo das Mercadorias Vendidas", "Custos de restaurante"];
/** 6 nomes do café da manhã na base; os de custo ficam aqui. */
export const BREAKFAST_COST_LABELS = ["(-) Custo com Café da manhã", "Custo com Café da Manhã", "Custos de café da manhã"];
export const LODGING_COST_LABELS = ["Custos de Hospedagem", "Despesas de Hospedagem"];
export const FIXED_COST_LABELS = ["DESPESAS FIXAS TOTAIS"];
export const VARIABLE_COST_LABELS = ["DESPESAS VARIÁVEIS TOTAL"];

export type IndicatorFormat = "pct" | "brl" | "brl2";

export interface IndicatorDef {
  key: string;
  label: string;
  /** Nomes alternativos aceitos (ex.: "Margem Bruta" para %GOP). */
  aliases?: string[];
  num: string[];
  den: string[];
  scale: number;
  format: IndicatorFormat;
  /** Custos vêm com sinal variável nas DREs; usa o valor absoluto. */
  absolute?: boolean;
  /** Indicador sem fonte na DRE (ex.: Turnover vem do RH). */
  unavailableNote?: string;
}

export const RATIO_SPECS: IndicatorDef[] = [
  { key: "ocupacao", label: "Taxa de Ocupação", num: OCCUPIED_LABELS, den: AVAILABLE_LABELS, scale: 100, format: "pct" },
  { key: "adr", label: "Diária Média (ADR)", num: LODGING_LABELS, den: OCCUPIED_LABELS, scale: 1, format: "brl" },
  { key: "revpar", label: "RevPAR", num: LODGING_LABELS, den: AVAILABLE_LABELS, scale: 1, format: "brl" },
  { key: "trevpar", label: "TrevPAR", num: REVENUE_LABELS, den: AVAILABLE_LABELS, scale: 1, format: "brl" },
  { key: "goppar", label: "GOPPAR", num: GOP_LABELS, den: AVAILABLE_LABELS, scale: 1, format: "brl" },
  { key: "gop_pct", label: "%GOP", aliases: ["Margem Bruta"], num: GOP_LABELS, den: REVENUE_LABELS, scale: 100, format: "pct" },
  { key: "margem_liquida", label: "Margem Líquida", num: NET_PROFIT_LABELS, den: REVENUE_LABELS, scale: 100, format: "pct" },
  { key: "labor_cost", label: "Labor Cost (% receita)", num: LABOR_LABELS, den: REVENUE_LABELS, scale: 100, format: "pct", absolute: true },
  { key: "custo_restaurante_rn", label: "Custo Restaurante / RN", num: CMV_LABELS, den: OCCUPIED_LABELS, scale: 1, format: "brl2", absolute: true },
  { key: "custo_cafe_rn", label: "Custo Café da Manhã / RN", num: BREAKFAST_COST_LABELS, den: OCCUPIED_LABELS, scale: 1, format: "brl2", absolute: true },
  { key: "custo_hospedagem_rn", label: "Custo de Hospedagem / RN", num: LODGING_COST_LABELS, den: OCCUPIED_LABELS, scale: 1, format: "brl2", absolute: true },
  { key: "custo_fixo_disp", label: "Custo fixo / quarto disponível", num: FIXED_COST_LABELS, den: AVAILABLE_LABELS, scale: 1, format: "brl2", absolute: true },
  { key: "custo_var_ocup", label: "Custo variável / quarto ocupado", num: VARIABLE_COST_LABELS, den: OCCUPIED_LABELS, scale: 1, format: "brl2", absolute: true },
  { key: "ab_hospede", label: "Receita de A&B / hóspede", num: AB_REVENUE_LABELS, den: GUESTS_LABELS, scale: 1, format: "brl2" },
  { key: "turnover", label: "Turnover", num: [], den: [], scale: 100, format: "pct", unavailableNote: "Aguardando data de desligamento na folha do RH" },
];

export function cleanLabel(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\s*\(\s*[=+-]\s*\)\s*/, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Encontra a linha do dataset por rótulo exato (tolerante a acento/caixa), na ordem dada. */
export function findNode(flat: DreLineNode[] | undefined, labels: string[]): DreLineNode | undefined {
  if (!flat) return undefined;
  for (const lbl of labels) {
    const needle = cleanLabel(lbl);
    const hit = flat.find((n) => cleanLabel(n.label) === needle && n.series.current.some((v) => v != null))
      ?? flat.find((n) => cleanLabel(n.label) === needle);
    if (hit) return hit;
  }
  return undefined;
}

export function ratioOver(
  num: DreMonthValue[] | undefined,
  den: DreMonthValue[] | undefined,
  months: number[],
  scale: number,
  absolute = false,
): number | null {
  if (!num || !den) return null;
  let n = 0, d = 0, any = false;
  for (const m of months) {
    const a = num[m - 1];
    const b = den[m - 1];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    n += absolute ? Math.abs(a) : a;
    d += b;
    any = true;
  }
  if (!any || d === 0) return null;
  return (n / d) * scale;
}

export function computeIndicator(
  def: IndicatorDef,
  flat: DreLineNode[] | undefined,
  months: number[],
  key: DreSeriesKey = "current",
): number | null {
  if (def.unavailableNote) return null;
  const num = findNode(flat, def.num);
  const den = findNode(flat, def.den);
  const denSeries = den?.series[key] ?? (def.den === AVAILABLE_LABELS ? deriveAvailable(flat, key) : undefined);
  return ratioOver(num?.series[key], denSeries, months, def.scale, def.absolute);
}

export function formatIndicator(def: { format: IndicatorFormat }, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "sem dado";
  if (def.format === "pct") return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * DREs sem linha de apartamentos disponíveis (ex.: Confins): disponíveis = Roomnights ÷ Taxa de Ocupação.
 */
export function deriveAvailable(flat: DreLineNode[] | undefined, key: DreSeriesKey = "current"): DreMonthValue[] | undefined {
  const occ = findNode(flat, OCCUPIED_LABELS)?.series[key];
  const rate = findNode(flat, ["Taxa de Ocupação"])?.series[key];
  if (!occ || !rate) return undefined;
  return occ.map((o, i) => {
    let r = rate[i];
    if (o == null || r == null || !Number.isFinite(o) || !Number.isFinite(r) || r === 0) return null;
    if (r > 1.5) r = r / 100;
    return o / r;
  }) as DreMonthValue[];
}
