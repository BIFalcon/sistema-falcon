import * as XLSX from "xlsx";

export type DreSeriesKey = "current" | "budget" | "previous";
export type DreMonthValue = number | null;

export interface DreLineNode {
  id: string;
  label: string;
  level: number;
  series: Record<DreSeriesKey, DreMonthValue[]>;
  children: DreLineNode[];
}

export interface DreAnalyticsDataset {
  tree: DreLineNode[];
  flat: DreLineNode[];
  hotelCount: number;
  sourceNames: string[];
}

const MONTHS = [
  ["janeiro", "jan"], ["fevereiro", "fev"], ["março", "marco", "fev"], ["abril", "abr"],
  ["maio", "mai"], ["junho", "jun"], ["julho", "jul"], ["agosto", "ago"],
  ["setembro", "set"], ["outubro", "out"], ["novembro", "nov"], ["dezembro", "dez"],
];

const REQUIRED_SHEETS: Record<DreSeriesKey, RegExp> = {
  current: /^dre$/i,
  budget: /^or[çc]amento$/i,
  previous: /^ano\s+anterior$/i,
};

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function makeId(label: string, level: number) {
  return `${level}:${normalize(label)}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function monthFromCell(cell: unknown): number | null {
  if (cell instanceof Date) return cell.getMonth() + 1;
  if (typeof cell !== "string") return null;
  const norm = normalize(cell);
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some((m) => norm === m || norm.startsWith(`${m}/`) || norm.startsWith(`${m} `))) return i + 1;
  }
  return null;
}

function findMonthColumns(rows: unknown[][]) {
  const cols = new Map<number, number>();
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    rows[r]?.forEach((cell, c) => {
      const month = monthFromCell(cell);
      if (month && !cols.has(month)) cols.set(month, c);
    });
  }
  return cols;
}

function extractLabel(row: unknown[]) {
  for (let c = 0; c < row.length; c++) {
    if (c === 1 || monthFromCell(row[c])) continue;
    if (typeof row[c] !== "string") continue;
    const value = row[c].trim();
    const norm = normalize(value);
    if (!value || norm === "nivel" || norm === "nível" || norm === "realizado" || norm === "orcamento") continue;
    return value;
  }
  return null;
}

function extractRows(rows: unknown[][], trimRealized: boolean) {
  const monthCols = findMonthColumns(rows);
  const out = new Map<string, DreLineNode>();
  for (const row of rows) {
    const level = asNumber(row[1]);
    if (!level || level < 1 || level > 3) continue;
    const label = extractLabel(row);
    if (!label) continue;
    const series = Array.from({ length: 12 }, (_, i) => asNumber(row[monthCols.get(i + 1) ?? -1]));
    if (trimRealized) {
      let last = -1;
      series.forEach((v, i) => { if (v != null && v !== 0) last = i; });
      for (let i = last + 1; i < series.length; i++) series[i] = null;
    }
    out.set(makeId(label, level), {
      id: makeId(label, level),
      label,
      level,
      series: { current: series, budget: Array(12).fill(null), previous: Array(12).fill(null) },
      children: [],
    });
  }
  return out;
}

function addSeries(a: DreMonthValue[], b: DreMonthValue[]) {
  return a.map((v, i) => (v == null && b[i] == null ? null : Number(v ?? 0) + Number(b[i] ?? 0)));
}

export function parseDreAnalyticsWorkbook(buffer: ArrayBuffer, sourceName: string): DreAnalyticsDataset {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const byKey = new Map<string, DreLineNode>();

  for (const [seriesKey, rx] of Object.entries(REQUIRED_SHEETS) as [DreSeriesKey, RegExp][]) {
    const sheetName = wb.SheetNames.find((name) => rx.test(name.trim()));
    if (!sheetName) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: null, raw: true });
    for (const node of extractRows(rows, seriesKey === "current").values()) {
      const existing = byKey.get(node.id);
      if (existing) existing.series[seriesKey] = node.series.current;
      else byKey.set(node.id, { ...node, series: { current: Array(12).fill(null), budget: Array(12).fill(null), previous: Array(12).fill(null), [seriesKey]: node.series.current } });
    }
  }

  return buildDataset(Array.from(byKey.values()), 1, [sourceName]);
}

export function mergeDreDatasets(datasets: DreAnalyticsDataset[]): DreAnalyticsDataset {
  const byKey = new Map<string, DreLineNode>();
  for (const dataset of datasets) {
    for (const node of dataset.flat) {
      const existing = byKey.get(node.id);
      if (!existing) byKey.set(node.id, { ...node, children: [] });
      else {
        existing.series.current = addSeries(existing.series.current, node.series.current);
        existing.series.budget = addSeries(existing.series.budget, node.series.budget);
        existing.series.previous = addSeries(existing.series.previous, node.series.previous);
      }
    }
  }
  return buildDataset(Array.from(byKey.values()), datasets.length, datasets.flatMap((d) => d.sourceNames));
}

function buildDataset(nodes: DreLineNode[], hotelCount: number, sourceNames: string[]): DreAnalyticsDataset {
  const roots: DreLineNode[] = [];
  const flat = nodes.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label, "pt-BR"));
  let lastL1: DreLineNode | null = null;
  let lastL2: DreLineNode | null = null;
  for (const node of flat) {
    node.children = [];
    if (node.level === 1) { roots.push(node); lastL1 = node; lastL2 = null; }
    else if (node.level === 2) { (lastL1?.children ?? roots).push(node); lastL2 = node; }
    else { (lastL2?.children ?? lastL1?.children ?? roots).push(node); }
  }
  return { tree: roots, flat, hotelCount, sourceNames };
}

export function findDreLine(dataset: DreAnalyticsDataset | undefined, label: string) {
  const needle = normalize(label);
  return dataset?.flat.find((line) => normalize(line.label) === needle || normalize(line.label).includes(needle));
}