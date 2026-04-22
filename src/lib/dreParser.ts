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
  lines: { row: number; label: string; value: number | null }[];
  warnings: string[];
  monthColumnIndex: number | null;
  monthHeaderLabel: string | null;
}

/**
 * Indicadores em ordem de prioridade. Cada indicador tem um conjunto de regex
 * para tentar bater com o rótulo da linha (mais à esquerda da linha).
 * Os regex foram construídos a partir das planilhas reais dos 4 modelos.
 */
const INDICATORS: { key: IndicatorKey; rx: RegExp[] }[] = [
  { key: "uhs_total", rx: [/^n[úu]mero\s+de\s+apartamentos$/i, /^n[úu]mero\s+de\s+apartamentos\s+no/i, /^uhs?\s+pool/i] },
  { key: "uhs_disponiveis", rx: [/n[úu]mero\s+de\s+apartamentos\s+dispon/i, /^apartamentos\s+dispon[íi]veis/i, /uhs?\s+dispon/i] },
  { key: "roomnights", rx: [/^roomnights$/i, /^room\s*nights?$/i, /^apartamentos\s+ocupados/i] },
  { key: "ocupacao", rx: [/taxa\s+de\s+ocupa/i] },
  { key: "adr", rx: [/^di[áa]ria\s+m[ée]dia\s+bruta/i, /^di[áa]ria\s+m[ée]dia(\s+\(em\s+r\$\))?$/i, /^di[áa]ria\s+m[ée]dia(?!\s+l[íi]quida)/i] },
  { key: "revpar", rx: [/^revpar\s+total/i, /^revpar\s+hospedagem/i, /^revpar(\s+\(em\s+r\$\))?$/i, /revpar/i] },
  { key: "receita_hospedagem", rx: [/^receita\s+(de\s+)?hospedagem/i] },
  { key: "receita_ab", rx: [/^receita\s+(bruta\s+)?a&b/i, /^receita\s+de\s+a&b/i, /^receitas?\s+(de\s+)?alimentos?\s+e\s+bebidas?/i] },
  { key: "receita_bruta_total", rx: [/^receita\s+bruta\s+total/i, /^receita\s+total\s+bruta/i, /^total\s+das?\s+receitas?\s+brutas?/i] },
  { key: "receita_liquida_total", rx: [/^receita\s+l[íi]quida\s+total/i, /^receita\s+total\s+l[íi]quida/i, /^\(=\)\s*receita\s+l[íi]quida/i, /^receita\s+l[íi]quida(?:\s|$)/i] },
  { key: "gop", rx: [/^resultado\s+operacional\s+bruto/i, /\bgop\b/i] },
  { key: "ebitda", rx: [/ebitda/i] },
  { key: "lucro_liquido", rx: [/^lucro\s+l[íi]quido/i, /^resultado\s+l[íi]quido\s+do\s+exerc/i, /^resultado\s+l[íi]quido/i] },
];

/**
 * Identifica o template a partir das abas existentes.
 * Mapeamento validado com planilhas reais (Modelo_-_Demais, Modelo_Mercure,
 * Modelo_Manhattan, Modelo_Confins).
 */
function detectTemplate(sheetNames: string[]): DreTemplate {
  const lower = sheetNames.map((n) => n.toLowerCase());
  const has = (s: string) => lower.some((n) => n.includes(s));
  // MANHATTAN: aba "DRE COLUNADO POOL" + várias abas com sufixos _COND/_POOL
  if (has("dre colunado pool") || has("dre_colunado_cond") || has("painel pool")) return "MANHATTAN";
  // MERCURE: aba "POOL - DRE COLUNADO"
  if (has("pool - dre colunado") || has("pool - balanço patrimonial")) return "MERCURE";
  // CONFINS: muitas abas "Ajuste <mês>" + "Lucro Presumido"
  const ajusteCount = lower.filter((n) => n.startsWith("ajuste ")).length;
  if (ajusteCount >= 5 || has("lucro presumido") || has("irpj.csll.l.presumido")) return "CONFINS";
  return "DEFAULT";
}

/**
 * Seleciona a aba que contém a DRE colunada com indicadores e valores mensais.
 * SEMPRE prefere a aba "crua" (não "Carta DRE") porque ela tem os números
 * mensais nas colunas, enquanto "Carta DRE" agrega trimestres / acumulados.
 */
function pickSheet(wb: XLSX.WorkBook, template: DreTemplate): string {
  const names = wb.SheetNames;
  const lower = names.map((n) => n.toLowerCase());
  const find = (test: (n: string) => boolean) => {
    const i = lower.findIndex(test);
    return i >= 0 ? names[i] : null;
  };
  if (template === "MANHATTAN") {
    return find((n) => n === "dre colunado pool") ?? find((n) => n.includes("dre colunado pool")) ?? find((n) => n === "dre") ?? names[0];
  }
  if (template === "MERCURE") {
    return find((n) => n === "pool - dre colunado") ?? find((n) => n.includes("dre colunado")) ?? names[0];
  }
  if (template === "CONFINS") {
    return find((n) => n === "dre") ?? find((n) => n.includes("dre") && !n.includes("old") && !n.includes("carta")) ?? names[0];
  }
  // DEFAULT: aba "DRE" (não "DRE (3)" nem "Carta DRE")
  return find((n) => n === "dre") ?? find((n) => n.includes("dre") && !n.includes("(") && !n.includes("carta")) ?? names[0];
}

/** Nomes dos meses em PT-BR para detectar o cabeçalho de meses. */
const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Localiza a linha de cabeçalho com nomes de meses e devolve o índice da
 * coluna correspondente ao mês alvo (1=Jan ... 12=Dez), além do label.
 */
function findMonthColumn(
  rows: unknown[][],
  targetMonth: number,
): { headerRow: number; colIndex: number; label: string } | null {
  const targetName = MONTH_NAMES[targetMonth === 3 ? 2 : targetMonth - 1] ?? "";
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        const norm = cell.trim().toLowerCase();
        if (norm === targetName || norm.startsWith(targetName)) {
          return { headerRow: r, colIndex: c, label: cell.trim() };
        }
      }
      // CONFINS: cabeçalho com Date object (ex.: 2026-01-01)
      if (cell instanceof Date) {
        if (cell.getMonth() + 1 === targetMonth) {
          return { headerRow: r, colIndex: c, label: cell.toISOString().slice(0, 10) };
        }
      }
    }
  }
  return null;
}

/** Extrai label da linha (primeira string não-vazia). */
function rowLabel(row: unknown[]): string | null {
  for (const cell of row) {
    if (typeof cell === "string" && cell.trim().length > 0) return cell.trim();
  }
  return null;
}

/**
 * Retorna o valor da linha para uma coluna específica. Se a coluna estiver
 * vazia, faz fallback para o último número finito não-zero da linha.
 *
 * IMPORTANTE: o fallback SÓ é usado quando `colIndex` é null (não foi possível
 * localizar a coluna do mês). Quando temos a coluna correta, devolvemos
 * exatamente o valor dela — inclusive 0 ou null — para evitar que o parser
 * pegue valores de colunas "Média"/"Total" por engano.
 */
function rowValueAt(
  row: unknown[],
  colIndex: number | null,
  excludeCols?: Set<number>,
): number | null {
  if (colIndex != null) {
    const c = row[colIndex];
    if (typeof c === "number" && Number.isFinite(c)) return c;
    // Coluna localizada mas célula vazia/string → não cai em fallback,
    // pois isso traria valores de outros meses (ex.: coluna "Média").
    return null;
  }
  for (let i = row.length - 1; i >= 0; i--) {
    if (excludeCols?.has(i)) continue;
    const c = row[i];
    if (typeof c === "number" && Number.isFinite(c) && c !== 0) return c;
  }
  return null;
}

export async function parseDreExcel(
  file: File,
  opts: { targetMonth?: number } = {},
): Promise<ParsedDre> {
  const buf = await file.arrayBuffer();
  // cellDates: true para que CONFINS (datas no header) gere objetos Date
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const template = detectTemplate(wb.SheetNames);
  const sheetName = pickSheet(wb, template);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba não encontrada (${sheetName})`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, defval: null, raw: true,
  });

  const indicators: Record<IndicatorKey, IndicatorHit | null> = {
    ocupacao: null, adr: null, revpar: null, roomnights: null,
    uhs_total: null, uhs_disponiveis: null,
    receita_hospedagem: null, receita_ab: null,
    receita_bruta_total: null, receita_liquida_total: null,
    gop: null, ebitda: null, lucro_liquido: null,
  };
  const lines: ParsedDre["lines"] = [];
  const warnings: string[] = [];

  // Localiza a coluna do mês alvo. Se não informado, último mês com dado é usado (fallback).
  const targetMonth = opts.targetMonth;
  const monthInfo = targetMonth ? findMonthColumn(rows, targetMonth) : null;
  const monthCol = monthInfo?.colIndex ?? null;
  if (targetMonth && !monthInfo) {
    warnings.push(`Coluna do mês ${targetMonth} não localizada no cabeçalho — usando fallback.`);
  }

  // Identifica colunas de "Média/Total/Acumulado" no cabeçalho para EVITAR
  // que o fallback de rowValueAt as utilize quando monthCol falha.
  const aggregateCols = new Set<number>();
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        const norm = cell.trim().toLowerCase();
        if (/^(m[ée]dia|total|acumulado|ano|ytd)\b/.test(norm)) aggregateCols.add(c);
      }
    }
  }

  rows.forEach((row, idx) => {
    if (!row || row.every((c) => c == null || c === "")) return;
    const label = rowLabel(row);
    if (!label) return;
    let value = rowValueAt(row, monthCol, aggregateCols);
    // CONFINS: "UHs Pool: 280" — extrai o número embutido no rótulo
    if (value == null) {
      const m = label.match(/(\d{2,5})\s*$/);
      if (m) value = Number(m[1]);
    }
    lines.push({ row: idx + 1, label, value });
    for (const ind of INDICATORS) {
      if (indicators[ind.key]) continue;
      if (ind.rx.some((rx) => rx.test(label))) {
        indicators[ind.key] = { key: ind.key, label, value, row: idx + 1, sheet: sheetName };
      }
    }
  });

  if (!indicators.gop) warnings.push("GOP / Resultado Operacional Bruto não localizado.");
  if (!indicators.receita_bruta_total) warnings.push("Receita Bruta Total não localizada.");
  if (!indicators.ocupacao) warnings.push("Taxa de Ocupação não localizada.");
  if (!indicators.lucro_liquido) warnings.push("Lucro Líquido não localizado.");

  return {
    template,
    sheetUsed: sheetName,
    indicators,
    lines,
    warnings,
    monthColumnIndex: monthCol,
    monthHeaderLabel: monthInfo?.label ?? null,
  };
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