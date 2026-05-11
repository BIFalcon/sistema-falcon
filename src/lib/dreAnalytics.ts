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
  ["janeiro", "jan"], ["fevereiro", "fev"], ["março", "marco", "mar"], ["abril", "abr"],
  ["maio", "mai"], ["junho", "jun"], ["julho", "jul"], ["agosto", "ago"],
  ["setembro", "set"], ["outubro", "out"], ["novembro", "nov"], ["dezembro", "dez"],
];

const REQUIRED_SHEETS: Record<DreSeriesKey, RegExp> = {
  current: /^dre(\s|$|_|-)/i,
  budget: /or[çc]amento/i,
  previous: /ano\s*anterior/i,
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

function findSheetStructure(rows: unknown[][]): {
  levelCol: number | null;
  labelCols: number[];
  monthCols: Map<number, number>;
} {
  const monthCols = new Map<number, number>();
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    (rows[r] ?? []).forEach((cell, c) => {
      const month = monthFromCell(cell);
      if (month && !monthCols.has(month)) monthCols.set(month, c);
    });
  }
  let levelCol: number | null = null;
  for (let c = 0; c <= 5; c++) {
    const nums = rows.slice(0, 80)
      .map((r) => asNumber((r ?? [])[c]))
      .filter((v): v is number => v === 1 || v === 2 || v === 3);
    if (nums.length >= 5) { levelCol = c; break; }
  }
  const monthColSet = new Set(monthCols.values());
  const freq: Record<number, number> = {};
  const SKIP = ['janeiro','fevereiro','março','marco','abril','maio','junho',
    'julho','agosto','setembro','outubro','novembro','dezembro',
    'total','média','media','nivel','nível','jan','fev','mar','abr',
    'mai','jun','jul','ago','set','out','nov','dez'];
  for (const row of rows.slice(0, 120)) {
    (row ?? []).forEach((cell, c) => {
      if (c === levelCol || monthColSet.has(c)) return;
      if (typeof cell !== 'string') return;
      const t = cell.trim();
      const norm = normalize(t);
      if (t.length < 3) return;
      if (SKIP.some((s) => norm.startsWith(s))) return;
      freq[c] = (freq[c] ?? 0) + 1;
    });
  }
  const labelCols = Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([c]) => Number(c));
  return { levelCol, labelCols, monthCols };
}

function extractRows(rows: unknown[][], sheetKey: DreSeriesKey) {
  const { levelCol, labelCols, monthCols } = findSheetStructure(rows);
  const out = new Map<string, DreLineNode>();
  for (const row of rows) {
    if (!row) continue;
    let level: number | null = levelCol != null ? asNumber(row[levelCol]) : null;
    if (!level || level < 1 || level > 3) {
      const hasDetailLabel = labelCols[0] != null &&
        typeof row[labelCols[0]] === 'string' &&
        String(row[labelCols[0]]).trim().length > 2;
      const hasGroupLabel = labelCols[1] != null &&
        typeof row[labelCols[1]] === 'string' &&
        String(row[labelCols[1]]).trim().length > 2;
      if (hasDetailLabel) level = 3;
      else if (hasGroupLabel) level = 2;
      else continue;
    }
    let label: string | null = null;
    for (const col of labelCols) {
      const v = typeof row[col] === 'string' ? String(row[col]).trim() : null;
      if (v && v.length > 2) { label = v; break; }
    }
    if (!label) continue;
    const norm = normalize(label);
    const STRUCTURAL = ['dre','topline','receitas','despesas','deducoes',
      'orcamento','ano anterior','resumo'];
    if (STRUCTURAL.some((s) => norm.startsWith(s) && norm.length < s.length + 10)) continue;
    const series: (number | null)[] = Array.from({ length: 12 }, (_, i) => {
      const col = monthCols.get(i + 1);
      return col != null ? asNumber(row[col]) : null;
    });
    if (sheetKey === 'current') {
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

const WEIGHTED_AVG_LABELS = [
  /taxa\s*de\s*ocupa/i,
  /fator\s*de\s*ocupa/i,
  /di[áa]ria\s*m[ée]dia|adr/i,
  /revpar/i,
  /margem|%\s*gop/i,
];

function isWeightedAvgIndicator(label: string): boolean {
  return WEIGHTED_AVG_LABELS.some((rx) => rx.test(label));
}

export function parseDreAnalyticsWorkbook(buffer: ArrayBuffer, sourceName: string): DreAnalyticsDataset {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const byKey = new Map<string, DreLineNode>();

  for (const [seriesKey, rx] of Object.entries(REQUIRED_SHEETS) as [DreSeriesKey, RegExp][]) {
    const sheetName = wb.SheetNames.find((name) => rx.test(name.trim()));
    if (!sheetName) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: null, raw: true });
    for (const node of extractRows(rows, seriesKey).values()) {
      const existing = byKey.get(node.id);
      if (existing) existing.series[seriesKey] = node.series.current;
      else byKey.set(node.id, { ...node, series: { current: Array(12).fill(null), budget: Array(12).fill(null), previous: Array(12).fill(null), [seriesKey]: node.series.current } });
    }
  }

  return buildDataset(Array.from(byKey.values()), 1, [sourceName]);
}

export function mergeDreDatasets(datasets: DreAnalyticsDataset[]): DreAnalyticsDataset {
  if (datasets.length === 0) {
    return { tree: [], flat: [], hotelCount: 0, sourceNames: [] };
  }
  if (datasets.length === 1) return datasets[0];

  // Agrupa nós por id em todos os datasets
  const grouped = new Map<string, DreLineNode[]>();
  for (const dataset of datasets) {
    for (const node of dataset.flat) {
      const arr = grouped.get(node.id) ?? [];
      arr.push(node);
      grouped.set(node.id, arr);
    }
  }

  const merged: DreLineNode[] = [];
  for (const [id, nodes] of grouped) {
    const label = nodes[0].label;
    const useAvg = isWeightedAvgIndicator(label);
    const series: Record<DreSeriesKey, DreMonthValue[]> = {
      current: Array(12).fill(null),
      budget: Array(12).fill(null),
      previous: Array(12).fill(null),
    };
    for (const key of ["current", "budget", "previous"] as DreSeriesKey[]) {
      for (let m = 0; m < 12; m++) {
        const vals = nodes
          .map((n) => n.series[key][m])
          .filter((v): v is number => v != null && Number.isFinite(v));
        if (vals.length === 0) {
          series[key][m] = null;
          continue;
        }
        const sum = vals.reduce((a, b) => a + b, 0);
        series[key][m] = useAvg ? sum / vals.length : sum;
      }
    }
    merged.push({
      id,
      label,
      level: nodes[0].level,
      series,
      children: [],
    });
  }

  return buildDataset(
    merged,
    datasets.reduce((s, d) => s + d.hotelCount, 0),
    datasets.flatMap((d) => d.sourceNames),
  );
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