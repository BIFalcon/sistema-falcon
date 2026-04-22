/**
 * Parser de planilhas DRE para os 4 modelos da rede Falcon:
 * DEFAULT, CONFINS, MERCURE, MANHATTAN.
 *
 * Estratégia: detectar o template via heurísticas de nomes de aba; para cada
 * indicador-chave, varrer linhas em busca de rótulos por regex (mais robusto do
 * que fixar números de linha, pois variam entre hotéis da mesma família).
 *
 * Para cada indicador retorna: rótulo encontrado, valor numérico (mais à
 * direita não-nulo da linha) e o número da linha original.
 */
import * as XLSX from "xlsx";

export type DreTemplate = "DEFAULT" | "CONFINS" | "MERCURE" | "MANHATTAN";

export type IndicatorKey =
  | "ocupacao"
  | "adr"
  | "revpar"
  | "roomnights"
  | "uhs_total"
  | "uhs_disponiveis"
  | "receita_hospedagem"
  | "receita_ab"
  | "receita_bruta_total"
  | "receita_liquida_total"
  | "gop"
  | "ebitda"
  | "lucro_liquido";

export interface IndicatorHit {
  key: IndicatorKey;
  label: string;
  value: number | null;
  row: number;
  sheet: string;
}

export interface ParsedDre {
  template: DreTemplate;
  sheetUsed: string;
  indicators: Record<IndicatorKey, IndicatorHit | null>;
  // todas as linhas significativas (rótulo + valor mais à direita) — útil para storage
  lines: { row: number; label: string; value: number | null }[];
  warnings: string[];
}

const INDICATORS: { key: IndicatorKey; rx: RegExp }[] = [
  { key: "ocupacao", rx: /taxa\s+de\s+ocupa/i },
  { key: "adr", rx: /di[áa]ria\s+m[ée]dia(?!\s+l[íi]quida)/i },
  { key: "revpar", rx: /revpar/i },
  { key: "roomnights", rx: /^roomnights$|apartamentos\s+ocupados|^room\s*nights?$/i },
  { key: "uhs_total", rx: /^n[úu]mero\s+de\s+apartamentos$|^uhs?\s+pool/i },
  { key: "uhs_disponiveis", rx: /n[úu]mero\s+de\s+apartamentos\s+dispon|uhs?\s+dispon/i },
  { key: "receita_hospedagem", rx: /^receita\s+(de\s+)?(bruta\s+)?(de\s+)?hospedagem/i },
  { key: "receita_ab", rx: /receita\s+bruta\s+a&b|receitas?\s+(de\s+)?alimentos?\s+e\s+bebidas?|^receita\s+a&b/i },
  { key: "receita_bruta_total", rx: /receita\s+(total\s+)?bruta(\s+total)?$|^receita\s+bruta\s+total$/i },
  { key: "receita_liquida_total", rx: /receita\s+(total\s+)?l[íi]quida(\s+total)?|receita\s+l[íi]quida\s+total/i },
  { key: "gop", rx: /\bgop\b|resultado\s+operacional\s+bruto/i },
  { key: "ebitda", rx: /ebitda/i },
  { key: "lucro_liquido", rx: /lucro\s+l[íi]quido|resultado\s+l[íi]quido(\s+do\s+exerc)?/i },
];

function detectTemplate(sheetNames: string[]): DreTemplate {
  const has = (s: string) => sheetNames.some((n) => n.toLowerCase().includes(s));
  if (has("pool - dre colunado") || has("pool - balanço") || has("rds")) return "MERCURE";
  if (has("painel pool") || has("dre_mensal_aeb") || has("painel condom")) return "MANHATTAN";
  if (has("irpj.csll") || has("ajuste julho 2023") || has("lucro presumido")) return "CONFINS";
  return "DEFAULT";
}

function pickSheet(wb: XLSX.WorkBook, template: DreTemplate): string {
  const names = wb.SheetNames;
  const lower = names.map((n) => n.toLowerCase());
  const find = (test: (n: string) => boolean) => {
    const i = lower.findIndex(test);
    return i >= 0 ? names[i] : null;
  };
  if (template === "MERCURE") return find((n) => n.includes("carta dre")) ?? find((n) => n.includes("dre")) ?? names[0];
  if (template === "MANHATTAN") return find((n) => n.includes("cartas dre")) ?? find((n) => n === "dre" || n.includes("dre colunado pool")) ?? names[0];
  if (template === "CONFINS") return find((n) => n === "dre") ?? find((n) => n.includes("dre")) ?? names[0];
  // DEFAULT: prefere "Carta DRE" (mais limpa) senão "DRE"
  return find((n) => n.includes("carta dre")) ?? find((n) => n === "dre") ?? find((n) => n.includes("dre")) ?? names[0];
}

function rowToValues(row: unknown[]): { label: string | null; value: number | null } {
  let label: string | null = null;
  let value: number | null = null;
  // label = primeira string não-vazia
  for (const cell of row) {
    if (typeof cell === "string" && cell.trim().length > 0) {
      label = cell.trim();
      break;
    }
  }
  // value = último número finito da linha
  for (let i = row.length - 1; i >= 0; i--) {
    const c = row[i];
    if (typeof c === "number" && Number.isFinite(c) && c !== 0) {
      value = c;
      break;
    }
  }
  // se todos forem zero, devolve 0
  if (value == null) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (typeof row[i] === "number") {
        value = row[i] as number;
        break;
      }
    }
  }
  return { label, value };
}

export async function parseDreExcel(file: File): Promise<ParsedDre> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const template = detectTemplate(wb.SheetNames);
  const sheetName = pickSheet(wb, template);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba não encontrada (${sheetName})`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

  const indicators: Record<IndicatorKey, IndicatorHit | null> = {
    ocupacao: null, adr: null, revpar: null, roomnights: null,
    uhs_total: null, uhs_disponiveis: null,
    receita_hospedagem: null, receita_ab: null,
    receita_bruta_total: null, receita_liquida_total: null,
    gop: null, ebitda: null, lucro_liquido: null,
  };
  const lines: ParsedDre["lines"] = [];
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    if (!row || row.every((c) => c == null || c === "")) return;
    const { label, value } = rowToValues(row);
    if (!label) return;
    lines.push({ row: idx + 1, label, value });
    for (const ind of INDICATORS) {
      if (indicators[ind.key]) continue;
      if (ind.rx.test(label)) {
        indicators[ind.key] = { key: ind.key, label, value, row: idx + 1, sheet: sheetName };
      }
    }
  });

  // sanity warnings
  if (!indicators.gop) warnings.push("GOP não localizado.");
  if (!indicators.receita_bruta_total) warnings.push("Receita Bruta Total não localizada.");
  if (!indicators.ocupacao) warnings.push("Taxa de Ocupação não localizada.");

  return { template, sheetUsed: sheetName, indicators, lines, warnings };
}

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  ocupacao: "Taxa de Ocupação",
  adr: "Diária Média (ADR)",
  revpar: "RevPAR",
  roomnights: "Room Nights",
  uhs_total: "UHs Totais",
  uhs_disponiveis: "UHs Disponíveis",
  receita_hospedagem: "Receita de Hospedagem",
  receita_ab: "Receita A&B",
  receita_bruta_total: "Receita Bruta Total",
  receita_liquida_total: "Receita Líquida Total",
  gop: "GOP",
  ebitda: "EBITDA",
  lucro_liquido: "Lucro Líquido",
};

export function formatIndicator(key: IndicatorKey, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "ocupacao") {
    // valores podem vir em fração (0.48) ou já em porcentagem
    const pct = value <= 1 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  if (key === "roomnights" || key === "uhs_total" || key === "uhs_disponiveis") {
    return Math.round(value).toLocaleString("pt-BR");
  }
  if (key === "adr" || key === "revpar") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}