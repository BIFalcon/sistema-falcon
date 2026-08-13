import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, LineChart as LineChartIcon, Upload, BarChart2, Table as TableIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useDreAnalytics } from "@/hooks/useDre";
import { useGopManagers } from "@/hooks/useGopManagers";
import { findDreLine, type DreLineNode, type DreMonthValue, type DreSeriesKey } from "@/lib/dreAnalytics";
import { MONTHS_PT } from "@/lib/constants";
import { fmtBRL } from "@/lib/formatters";
import { uploadRetroactiveDre } from "@/lib/retroactiveDreUpload";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DRE_FILE_EXTENSIONS = /\.(xlsx|xlsm|xls|csv)$/i;

const CATEGORY_ORDER = ["Topline", "Receitas", "Despesas", "Despesas Específicas"];

/**
 * agg = "sum" para receitas/GOP (acumular no período)
 * agg = "avg" para taxas/médias (Ocupação, ADR, RevPAR)
 * agg = "ratio" para indicadores percentuais (%GOP, Margem Líquida) — calculado como
 *        soma(numerador) / soma(denominador) no período.
 */
type CardDef =
  | { title: string; format: "pct" | "brl"; agg: "sum" | "avg"; labels: string[] }
  | { title: string; format: "pct"; agg: "ratio"; numLabels: string[]; denLabels: string[] };

const CARD_LINES: CardDef[] = [
  { title: "Taxa de Ocupação", format: "pct", agg: "avg", labels: ["Taxa de Ocupação"] },
  { title: "ADR", format: "brl", agg: "avg", labels: ["Diária Média", "ADR"] },
  { title: "RevPAR", format: "brl", agg: "avg", labels: ["RevPAR"] },
  {
    title: "Receita Bruta Total",
    format: "brl",
    agg: "sum",
    labels: ["Receita Bruta Total", "RECEITA BRUTA TOTAL", "Receita Total Bruta"],
  },
  { title: "GOP", format: "brl", agg: "sum", labels: ["GOP", "Resultado Operacional Bruto"] },
  {
    title: "%GOP",
    format: "pct",
    agg: "ratio",
    numLabels: ["GOP", "Resultado Operacional Bruto"],
    denLabels: ["Receita Bruta Total", "RECEITA BRUTA TOTAL", "Receita Total Bruta"],
  },
  {
    title: "Lucro Líquido",
    format: "brl",
    agg: "sum",
    labels: ["Lucro / Prejuízo a Distribuir", "Lucro Líquido", "Resultado Líquido"],
  },
  {
    title: "Margem Líquida",
    format: "pct",
    agg: "ratio",
    numLabels: ["Lucro / Prejuízo a Distribuir", "Lucro Líquido", "Resultado Líquido"],
    denLabels: ["Receita Bruta Total", "RECEITA BRUTA TOTAL", "Receita Total Bruta"],
  },
];

type AggType = "sum" | "avg" | "weighted_avg";

const AGG_RULES: Array<{ pattern: RegExp; agg: AggType }> = [
  // Médias ponderadas por Room Nights / UHs disponíveis
  { pattern: /taxa\s*de\s*ocupa/i,     agg: "weighted_avg" },
  { pattern: /diária\s*média|adr/i,    agg: "weighted_avg" },
  { pattern: /revpar/i,                agg: "weighted_avg" },
  { pattern: /fator\s*de\s*ocupa/i,    agg: "avg" },
  // Porcentagens — média simples
  { pattern: /%\s*gop/i,               agg: "avg" },
  { pattern: /margem\s*l[íi]quida/i,   agg: "avg" },
  // Tudo mais → soma
];

function getAggType(label: string): AggType {
  for (const rule of AGG_RULES) {
    if (rule.pattern.test(label)) return rule.agg;
  }
  return "sum"; // default: receitas, despesas, GOP, etc.
}

type PeriodKey = "1" | "2" | "3" | "6" | "12";
const PERIOD_OPTIONS: { value: PeriodKey; label: string; months: number }[] = [
  { value: "1", label: "Mensal", months: 1 },
  { value: "2", label: "Bimestral", months: 2 },
  { value: "3", label: "Trimestral", months: 3 },
  { value: "6", label: "Semestral", months: 6 },
  { value: "12", label: "Anual", months: 12 },
];

const chartConfig = {
  current:  { label: "Realizado",    color: "#1D4ED8" },
  budget:   { label: "Orçado",       color: "#16A34A" },
  previous: { label: "Ano Anterior", color: "#9CA3AF" },
} satisfies ChartConfig;

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function variation(current: number | null | undefined, base: number | null | undefined) {
  if (current == null || base == null || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}
function valueAt(series: DreMonthValue[], month: number) {
  if (month === 0) return series.reduce<number | null>((sum, v) => (v == null ? sum : Number(sum ?? 0) + v), null);
  return series[month - 1] ?? null;
}

/**
 * Retorna a janela de meses (1-based) para um período terminando em `endMonth`.
 * Se endMonth = 0 (acumulado) ou periodMonths = 12, retorna todos de 1..12.
 */
function periodMonths(endMonth: number, periodMonths: number): number[] {
  if (endMonth === 0 || periodMonths >= 12) {
    return Array.from({ length: 12 }, (_, i) => i + 1);
  }
  const start = Math.max(1, endMonth - periodMonths + 1);
  return Array.from({ length: endMonth - start + 1 }, (_, i) => start + i);
}

function aggregateSeries(
  series: DreMonthValue[],
  months: number[],
  agg: "sum" | "avg",
): number | null {
  const vals = months
    .map((m) => series[m - 1])
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  return agg === "sum" ? total : total / vals.length;
}

function aggregateRatio(
  num: DreMonthValue[],
  den: DreMonthValue[],
  months: number[],
): number | null {
  let sumN = 0;
  let sumD = 0;
  let any = false;
  for (const m of months) {
    const n = num[m - 1];
    const d = den[m - 1];
    if (n != null && d != null && Number.isFinite(n) && Number.isFinite(d)) {
      sumN += n;
      sumD += d;
      any = true;
    }
  }
  if (!any || sumD === 0) return null;
  return (sumN / sumD) * 100;
}

function pickLine(
  dataset: ReturnType<typeof useDreAnalytics>["data"],
  labels: string[],
): DreLineNode | undefined {
  for (const lbl of labels) {
    const ln = findDreLine(dataset ?? undefined, lbl);
    if (ln) return ln;
  }
  return undefined;
}

function aggregateSelectedSeries(
  lines: DreLineNode[],
  key: DreSeriesKey,
  dataset: ReturnType<typeof useDreAnalytics>["data"],
): DreMonthValue[] {
  if (lines.length === 0) return Array(12).fill(null);
  const aggTypes = lines.map((l) => getAggType(l.label));
  const allSame = aggTypes.every((a) => a === aggTypes[0]);
  const agg = allSame ? aggTypes[0] : "sum";

  if (agg === "sum") {
    return sumSeries(lines, key);
  }
  if (agg === "avg") {
    return Array.from({ length: 12 }, (_, i) => {
      const vals = lines
        .map((l) => l.series[key][i])
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    });
  }
  if (agg === "weighted_avg") {
    const roomNightsLine =
      findDreLine(dataset ?? undefined, "Apartamentos Ocupados") ??
      findDreLine(dataset ?? undefined, "Apartamentos ocupados") ??
      findDreLine(dataset ?? undefined, "Room Nights");
    if (!roomNightsLine) {
      return Array.from({ length: 12 }, (_, i) => {
        const vals = lines
          .map((l) => l.series[key][i])
          .filter((v): v is number => v != null && Number.isFinite(v));
        if (vals.length === 0) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      });
    }
    return Array.from({ length: 12 }, (_, i) => {
      let sumWeighted = 0;
      let sumWeights = 0;
      for (const line of lines) {
        const val = line.series[key][i];
        const rn = roomNightsLine.series[key][i];
        if (val == null || rn == null || !Number.isFinite(val) || !Number.isFinite(rn) || rn === 0) continue;
        sumWeighted += val * rn;
        sumWeights += rn;
      }
      return sumWeights > 0 ? sumWeighted / sumWeights : null;
    });
  }
  return Array(12).fill(null);
}

function computeCardValue(
  card: CardDef,
  dataset: ReturnType<typeof useDreAnalytics>["data"],
  months: number[],
  series: DreSeriesKey,
): number | null {
  if (card.agg === "ratio") {
    // Tenta cada combinação numerador × denominador até obter um valor
    // não-nulo na série pedida (importante para Margem Líquida em
    // Orçado/Ano Anterior, onde "Lucro a Distribuir" não tem dados,
    // mas "Lucro Líquido / Prejuízo do Exercício" tem).
    for (const nLbl of card.numLabels) {
      const num = findDreLine(dataset ?? undefined, nLbl);
      if (!num) continue;
      for (const dLbl of card.denLabels) {
        const den = findDreLine(dataset ?? undefined, dLbl);
        if (!den) continue;
        const v = aggregateRatio(num.series[series], den.series[series], months);
        if (v != null) return v;
      }
    }
    return null;
  }
  const line = pickLine(dataset, card.labels);
  if (!line) return null;
  const v = aggregateSeries(line.series[series], months, card.agg);
  if (v == null) return null;
  // Para períodos com múltiplos meses, usa média ponderada por RN
  if (months.length > 1 && (card.title === "Taxa de Ocupação" || card.title === "ADR" || card.title === "RevPAR")) {
    const rnLine = pickLine(dataset, ["Apartamentos Ocupados", "Apartamentos ocupados", "Room Nights"]);
    if (rnLine) {
      let sumWeighted = 0;
      let sumWeights = 0;
      for (const m of months) {
        const val = line.series[series][m - 1];
        const rn = rnLine.series[series][m - 1];
        if (val != null && rn != null && Number.isFinite(val) && Number.isFinite(rn) && rn > 0) {
          sumWeighted += val * rn;
          sumWeights += rn;
        }
      }
      if (sumWeights > 0) {
        const weighted = sumWeighted / sumWeights;
        if (card.title === "Taxa de Ocupação") return weighted <= 1 ? weighted * 100 : weighted;
        return weighted;
      }
    }
  }
  // Taxa de Ocupação vem em fração ou %; normaliza para %
  if (card.title === "Taxa de Ocupação") return v <= 1 ? v * 100 : v;
  return v;
}

function sumSeries(lines: DreLineNode[], key: DreSeriesKey) {
  return Array.from({ length: 12 }, (_, i) => {
    let hasValue = false;
    const total = lines.reduce((sum, line) => {
      const value = line.series[key][i];
      if (value != null) hasValue = true;
      return sum + Number(value ?? 0);
    }, 0);
    return hasValue ? total : null;
  });
}
function divideSeries(values: DreMonthValue[], divisor?: DreLineNode, key?: DreSeriesKey) {
  if (!divisor || !key) return values;
  return values.map((value, i) => {
    const base = divisor.series[key][i];
    return value == null || !base ? null : value / base;
  });
}

/**
 * Variação do Realizado vs base (Orçado / Ano Anterior).
 * - Receitas: realizado maior → +% verde; menor → -% vermelho.
 * - Despesas: realizado maior (gasto maior) → +% vermelho; menor → -% verde.
 *   Para despesas comparamos magnitudes (valores vêm negativos na DRE).
 */
function variationFor(
  current: number | null | undefined,
  base: number | null | undefined,
  isExpense: boolean,
) {
  if (current == null || base == null) return null;
  if (isExpense) {
    const c = Math.abs(current);
    const b = Math.abs(base);
    if (b === 0) return null;
    return ((c - b) / b) * 100;
  }
  return variation(current, base);
}

function VariationPill({ value, isExpense = false }: { value: number | null; isExpense?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  const good = isExpense ? !up : up;
  return (
    <span className={good ? "text-success" : "text-destructive"}>
      {up ? "+" : ""}
      {pct(value)}
    </span>
  );
}

function isPctLineLabel(label: string) {
  return /taxa\s*de\s*ocupa|%\s*gop|margem|fator\s*de\s*ocupa/i.test(label);
}

/** Linhas que são contagens (não monetárias): apartamentos, hóspedes, room nights. */
function isCountLineLabel(label: string) {
  return /(apartamentos|quartos|uh)\s*(ocupados|dispon)|room\s*nights|n[uú]mero\s*de\s*h[oó]spedes|h[oó]spedes|di[aá]rias\s*vendidas/i.test(
    label,
  );
}

function computeNodeValue(node: DreLineNode, key: DreSeriesKey, months: number[]): number | null {
  const agg = getAggType(node.label);
  const baseAgg: "sum" | "avg" = agg === "sum" ? "sum" : "avg";
  const v = aggregateSeries(node.series[key], months, baseAgg);
  if (v == null) return null;
  if (isPctLineLabel(node.label)) return Math.abs(v) <= 1 ? v * 100 : v;
  return v;
}

function fmtNodeValue(node: DreLineNode, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (isPctLineLabel(node.label)) return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (isCountLineLabel(node.label))
    return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return fmtBRL(v);
}

function DreComparativeRow({
  node,
  depth,
  months,
  expanded,
  toggle,
  isExpense,
}: {
  node: DreLineNode;
  depth: number;
  months: number[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  isExpense: boolean;
}) {
  const cur = computeNodeValue(node, "current", months);
  const bud = computeNodeValue(node, "budget", months);
  const prev = computeNodeValue(node, "previous", months);
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  return (
    <>
      <TableRow>
        <TableCell className="py-2">
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            {hasChildren ? (
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => toggle(node.id)}>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            ) : (
              <span className="inline-block w-5 shrink-0" />
            )}
            <span className={depth === 0 ? "text-sm font-medium" : "text-sm text-foreground/80"}>{node.label}</span>
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums text-[13px] whitespace-nowrap">{fmtNodeValue(node, cur)}</TableCell>
        <TableCell className="text-right tabular-nums text-[13px] whitespace-nowrap">{fmtNodeValue(node, bud)}</TableCell>
        <TableCell className="text-right text-sm"><VariationPill value={variationFor(cur, bud, isExpense)} isExpense={isExpense} /></TableCell>
        <TableCell className="text-right tabular-nums text-[13px] whitespace-nowrap">{fmtNodeValue(node, prev)}</TableCell>
        <TableCell className="text-right text-sm"><VariationPill value={variationFor(cur, prev, isExpense)} isExpense={isExpense} /></TableCell>
      </TableRow>
      {isOpen && hasChildren && node.children.map((child) => (
        <DreComparativeRow key={child.id} node={child} depth={depth + 1} months={months} expanded={expanded} toggle={toggle} isExpense={isExpense} />
      ))}
    </>
  );
}

function TreeLine({ node, selectedIds, select }: { node: DreLineNode; selectedIds: Set<string>; select: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const isSelectable = !(node.level === 1 && /^(topline|receitas|despesas)$/i.test(node.label));
  const fontClass =
    node.level === 1
      ? "text-sm font-semibold"
      : node.level === 2
      ? "text-sm font-medium text-foreground/80"
      : "text-xs text-muted-foreground";
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/70" style={{ paddingLeft: `${(node.level - 1) * 16 + 8}px` }}>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen((v) => !v)} disabled={!hasChildren}>
          {hasChildren ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : <span />}
        </Button>
        {isSelectable ? (
          <Checkbox checked={selectedIds.has(node.id)} onCheckedChange={() => select(node.id)} />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className={fontClass}>{node.label}</span>
      </div>
      {open && node.children.map((child) => <TreeLine key={child.id} node={child} selectedIds={selectedIds} select={select} />)}
    </div>
  );
}

export default function IndicadoresDrePage() {
  const { allowedHotels, isMaster, user } = useAuth();
  const { hotelId, hotelIds: selectedHotelIds, gopId, month, year, setHotelId } = useModuleFilters("indicadores");
  const queryClient = useQueryClient();
  const { data: gopManagers = [] } = useGopManagers();
  const selectedGop = useMemo(
    () => gopManagers.find((g) => g.user_id === gopId),
    [gopManagers, gopId],
  );
  const gopHotelIds = useMemo(
    () => (selectedGop ? new Set(selectedGop.hotel_ids) : null),
    [selectedGop],
  );
  const hotelOptions = useMemo(
    () => (gopHotelIds ? allowedHotels.filter((h) => gopHotelIds.has(h.id)) : allowedHotels),
    [allowedHotels, gopHotelIds],
  );
  const [retroOpen, setRetroOpen] = useState(false);
  const [retroHotelId, setRetroHotelId] = useState<string>("");
  const [retroYear, setRetroYear] = useState<number>(new Date().getFullYear());
  const [retroUpToMonth, setRetroUpToMonth] = useState<number>(12);
  const [retroFile, setRetroFile] = useState<File | null>(null);
  const [retroSubmitting, setRetroSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<DreSeriesKey, boolean>>({ current: true, budget: true, previous: true });
  
  const [divider, setDivider] = useState("none");
  const [period, setPeriod] = useState<PeriodKey>("1");
  // Seleção múltipla de meses — quando preenchida, substitui a janela do período
  const [customMonths, setCustomMonths] = useState<number[]>([]);
  const showAsPct = divider === "revenue";
  const hotelIds = useMemo(() => {
    if (selectedHotelIds && selectedHotelIds.length > 0) return selectedHotelIds;
    if (hotelId) return [hotelId];
    return [];
  }, [hotelOptions, hotelId, selectedHotelIds]);
  const noHotelSelected = hotelIds.length === 0;
  const periodCfg = PERIOD_OPTIONS.find((p) => p.value === period) ?? PERIOD_OPTIONS[0];
  const { data: dataset, isLoading } = useDreAnalytics({
    hotelIds,
    year,
    month,
    periodMonths: periodCfg.months,
  });

  const selectedNodes = useMemo(() => {
    if (!dataset || selectedIds.size === 0) return [] as DreLineNode[];
    return dataset.flat.filter((n) => selectedIds.has(n.id));
  }, [dataset, selectedIds]);
  // Linhas usadas no gráfico (mantém comportamento anterior: expande para folhas se a linha é apenas um agrupador)
  const selectedLines = useMemo(() => {
    if (selectedNodes.length === 0) return [] as DreLineNode[];
    const leaves = (n: DreLineNode): DreLineNode[] =>
      n.children.length === 0 ? [n] : n.children.flatMap(leaves);
    const out: DreLineNode[] = [];
    for (const node of selectedNodes) {
      const hasSeries = node.series.current.some((v) => v != null);
      if (hasSeries || node.children.length === 0) out.push(node);
      else out.push(...leaves(node));
    }
    return out;
  }, [selectedNodes]);
  const divisorLine = useMemo(() => {
    if (!dataset || divider === "none") return undefined;
    if (divider === "roomnights") return findDreLine(dataset, "Apartamentos ocupados");
    if (divider === "uhs") return findDreLine(dataset, "Número de apartamentos disponíveis");
    if (divider === "netprofit")
      return (
        findDreLine(dataset, "Lucro Líquido / Prejuízo do Exercício") ??
        findDreLine(dataset, "Lucro Líquido") ??
        findDreLine(dataset, "Lucro / Prejuízo a Distribuir do período")
      );
    if (divider === "lodging") return findDreLine(dataset, "Receita de Hospedagem");
    return findDreLine(dataset, "RECEITA BRUTA TOTAL");
  }, [dataset, divider]);

  // IDs de todas as linhas que descendem de um bloco de Despesas
  const expenseIds = useMemo(() => {
    const ids = new Set<string>();
    if (!dataset) return ids;
    const collect = (n: DreLineNode) => {
      ids.add(n.id);
      n.children.forEach(collect);
    };
    for (const root of dataset.tree) {
      if (/despesa|custo/i.test(root.label)) collect(root);
    }
    return ids;
  }, [dataset]);
  const isExpenseNode = (node: DreLineNode) =>
    expenseIds.has(node.id) || /despesa|custo/i.test(node.label);

  // Limpa a seleção quando o filtro de hotel muda
  const hotelKey = hotelIds.join(",");
  const prevHotelKey = useRef(hotelKey);
  useEffect(() => {
    if (prevHotelKey.current !== hotelKey) {
      prevHotelKey.current = hotelKey;
      setSelectedIds(new Set());
      setExpandedRows(new Set());
    }
  }, [hotelKey]);

  const buildChartData = (lines: DreLineNode[]) => {
    const pMonths = periodCfg.months;
    type ChartPoint = { label: string; months: number[] };
    let points: ChartPoint[];
    if (pMonths === 1) {
      points = MONTHS_SHORT.map((m, i) => ({ label: m, months: [i + 1] }));
    } else if (pMonths === 2) {
      points = [
        { label: "B1", months: [1, 2] },
        { label: "B2", months: [3, 4] },
        { label: "B3", months: [5, 6] },
        { label: "B4", months: [7, 8] },
        { label: "B5", months: [9, 10] },
        { label: "B6", months: [11, 12] },
      ];
    } else if (pMonths === 3) {
      points = [
        { label: "T1", months: [1, 2, 3] },
        { label: "T2", months: [4, 5, 6] },
        { label: "T3", months: [7, 8, 9] },
        { label: "T4", months: [10, 11, 12] },
      ];
    } else if (pMonths === 6) {
      points = [
        { label: "S1", months: [1, 2, 3, 4, 5, 6] },
        { label: "S2", months: [7, 8, 9, 10, 11, 12] },
      ];
    } else {
      points = [{ label: String(year), months: Array.from({ length: 12 }, (_, i) => i + 1) }];
    }

    function aggPoint(
      series: DreMonthValue[],
      months: number[],
      aggType: AggType,
      rnSeries?: DreMonthValue[],
    ): number | null {
      const vals = months.map((m) => series[m - 1]).filter((v): v is number => v != null && Number.isFinite(v));
      if (vals.length === 0) return null;
      if (aggType === "sum") return vals.reduce((a, b) => a + b, 0);
      if (aggType === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
      if (aggType === "weighted_avg" && rnSeries) {
        let sumW = 0, sumRn = 0;
        for (const m of months) {
          const v = series[m - 1];
          const rn = rnSeries[m - 1];
          if (v != null && rn != null && Number.isFinite(v) && Number.isFinite(rn) && rn > 0) {
            sumW += v * rn;
            sumRn += rn;
          }
        }
        return sumRn > 0 ? sumW / sumRn : null;
      }
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    const lineAgg = lines.length > 0 ? getAggType(lines[0].label) : "sum";

    const rnNode = findDreLine(dataset ?? undefined, "Apartamentos ocupados")
      ?? findDreLine(dataset ?? undefined, "Apartamentos Ocupados")
      ?? findDreLine(dataset ?? undefined, "Room Nights");

    const baseCurrent = divideSeries(aggregateSelectedSeries(lines, "current", dataset), divisorLine, "current");
    const baseBudget = divideSeries(aggregateSelectedSeries(lines, "budget", dataset), divisorLine, "budget");
    const basePrevious = divideSeries(aggregateSelectedSeries(lines, "previous", dataset), divisorLine, "previous");

    return points.map(({ label, months }) => {
      const cur = aggPoint(baseCurrent, months, lineAgg, rnNode?.series.current);
      const bud = aggPoint(baseBudget, months, lineAgg, rnNode?.series.budget);
      const prev = aggPoint(basePrevious, months, lineAgg, rnNode?.series.previous);
      return {
        month: label,
        current: cur,
        budget: bud,
        previous: prev,
      };
    });
  };

  const expandLeaves = (nodes: DreLineNode[]): DreLineNode[] => {
    const leaves = (n: DreLineNode): DreLineNode[] =>
      n.children.length === 0 ? [n] : n.children.flatMap(leaves);
    const out: DreLineNode[] = [];
    for (const node of nodes) {
      const hasSeries = node.series.current.some((v) => v != null);
      if (hasSeries || node.children.length === 0) out.push(node);
      else out.push(...leaves(node));
    }
    return out;
  };

  /**
   * Até 2 gráficos: com 2+ linhas selecionadas, gera um gráfico por linha
   * (máximo de 2, empilhados) para comparação.
   */
  const chartGroups = useMemo(() => {
    if (selectedNodes.length === 0) {
      return [{ key: "empty", title: "", lines: [] as DreLineNode[], isExpense: false }];
    }
    if (selectedNodes.length === 1) {
      return [{
        key: selectedNodes[0].id,
        title: selectedNodes[0].label,
        lines: expandLeaves([selectedNodes[0]]),
        isExpense: isExpenseNode(selectedNodes[0]),
      }];
    }
    return selectedNodes.slice(0, 2).map((node) => ({
      key: node.id,
      title: node.label,
      lines: expandLeaves([node]),
      isExpense: isExpenseNode(node),
    }));
  }, [selectedNodes, expenseIds]);

  /**
   * Formatador por gráfico: cada gráfico usa o tipo de valor das SUAS linhas
   * (percentual, contagem ou moeda) — nunca o tipo do gráfico anterior.
   */
  const makeChartFormatter = (lines: DreLineNode[]) => {
    const isPct = lines.some((l) => isPctLineLabel(l.label));
    const isCount = !isPct && lines.length > 0 && lines.every((l) => isCountLineLabel(l.label));
    return (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "—";
      if (showAsPct) return `${(numeric * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
      if (isPct) {
        const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
        return `${normalized.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
      }
      if (isCount) return numeric.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
      return numeric.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    };
  };
  const selectLine = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const monthsWindow = useMemo(
    () =>
      customMonths.length > 0
        ? [...customMonths].sort((a, b) => a - b)
        : periodMonths(month, periodCfg.months),
    [month, periodCfg.months, customMonths],
  );
  const periodLabel = useMemo(() => {
    if (customMonths.length > 0) {
      const sorted = [...customMonths].sort((a, b) => a - b);
      return `${sorted.map((m) => MONTHS_SHORT[m - 1]).join(" + ")} de ${year}`;
    }
    if (monthsWindow.length === 12) return `Acumulado de ${year}`;
    if (monthsWindow.length === 1) return `${MONTHS_PT[monthsWindow[0] - 1]} de ${year}`;
    const first = MONTHS_PT[monthsWindow[0] - 1];
    const last = MONTHS_PT[monthsWindow[monthsWindow.length - 1] - 1];
    return `${first}–${last} de ${year}`;
  }, [monthsWindow, year, customMonths]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Análise</p>
          <h1 className="text-2xl font-semibold text-foreground">Indicadores DRE</h1>
          <p className="text-sm text-muted-foreground">{hotelId ? "Hotel selecionado" : `${hotelIds.length} hotéis`} · {month === 0 ? "Acumulado do ano" : MONTHS_PT[month - 1]} de {year}</p>
        </div>
        {isMaster && (
          <Dialog open={retroOpen} onOpenChange={setRetroOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Upload retroativo
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload retroativo de DRE</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Hotel</Label>
                  <Select value={retroHotelId} onValueChange={setRetroHotelId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o hotel" /></SelectTrigger>
                    <SelectContent className="bg-popover">
                      {allowedHotels.map((h) => (
                        <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Ano</Label>
                    <Select value={String(retroYear)} onValueChange={(v) => setRetroYear(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        {[new Date().getFullYear() - 3, new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Processar até o mês</Label>
                    <Select value={String(retroUpToMonth)} onValueChange={(v) => setRetroUpToMonth(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        {MONTHS_PT.map((label, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retro-file">Arquivo da DRE (.xlsx, .xlsm, .xls)</Label>
                  <Input
                    id="retro-file"
                    type="file"
                    onChange={(e) => {
                      const selected = e.target.files?.[0] ?? null;
                      if (!selected) {
                        setRetroFile(null);
                        return;
                      }
                      if (!DRE_FILE_EXTENSIONS.test(selected.name)) {
                        setRetroFile(null);
                        e.currentTarget.value = "";
                        toast.error("Formato inválido", {
                          description: "Envie um arquivo Excel (.xlsx, .xlsm, .xls) ou .csv.",
                        });
                        return;
                      }
                      setRetroFile(selected);
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={retroSubmitting || !retroHotelId || !retroFile || !user}
                  onClick={async () => {
                    if (!user || !retroHotelId || !retroFile) return;
                    if (!DRE_FILE_EXTENSIONS.test(retroFile.name)) {
                      toast.error("Formato inválido", {
                        description: "Envie um arquivo Excel (.xlsx, .xlsm, .xls) ou .csv.",
                      });
                      return;
                    }
                    setRetroSubmitting(true);
                    try {
                      const res = await uploadRetroactiveDre({
                        hotelId: retroHotelId,
                        year: retroYear,
                        file: retroFile,
                        userId: user.id,
                        upToMonth: retroUpToMonth,
                      });
                      toast.success("DRE enviada", {
                        description: res.monthsProcessed.length > 0
                          ? `${res.monthsProcessed.length} mês(es) processado(s): ${res.monthsProcessed.map((m) => MONTHS_PT[m - 1]).join(", ")}`
                          : "Nenhum mês com dados encontrado.",
                      });
                      setRetroFile(null);
                      setRetroOpen(false);
                      queryClient.invalidateQueries({ queryKey: ["dre-analytics"] });
                    } catch (err) {
                      toast.error("Erro no upload", {
                        description: err instanceof Error ? err.message : "Falha desconhecida",
                      });
                    } finally {
                      setRetroSubmitting(false);
                    }
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {retroSubmitting ? "Processando…" : "Carregar DRE"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {noHotelSelected ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <BarChart2 className="h-12 w-12 opacity-20" />
          <p className="text-sm">Selecione um hotel no filtro acima para ver os indicadores.</p>
        </div>
      ) : !dataset && !isLoading ? (
        <Card className="p-8 text-center shadow-soft">
          <LineChartIcon className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Nenhuma DRE encontrada</h2>
          <p className="text-sm text-muted-foreground">Faça upload da DRE no Workflow de Fechamento para o hotel e ano selecionados.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Período
              </span>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    {customMonths.length === 0
                      ? "Meses (múltiplos)"
                      : `${customMonths.length} mês(es) somados`}
                    <ChevronDown className="h-4 w-4 ml-1.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] bg-popover" align="start">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Somar meses
                    </span>
                    {customMonths.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setCustomMonths([])}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {MONTHS_PT.map((label, i) => {
                      const m = i + 1;
                      const checked = customMonths.includes(m);
                      return (
                        <label
                          key={m}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/70 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() =>
                              setCustomMonths((prev) =>
                                prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
                              )
                            }
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Ao selecionar meses aqui, o período acima é ignorado.
                  </p>
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {CARD_LINES.map((card) => {
              const cur = computeCardValue(card, dataset, monthsWindow, "current");
              const bud = computeCardValue(card, dataset, monthsWindow, "budget");
              const prev = computeCardValue(card, dataset, monthsWindow, "previous");
              const fmt = (v: number | null) =>
                card.format === "pct" ? pct(v) : fmtBRL(v);
              return (
                <Card key={card.title} className="p-3 shadow-soft">
                  <h3 className="text-xs font-semibold mb-2 truncate">{card.title}</h3>
                  <div className="grid grid-cols-3 gap-1 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">Realizado</p>
                      <p className="font-semibold text-foreground tabular-nums">{fmt(cur)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Orçado</p>
                      <p className="font-semibold text-foreground tabular-nums">{fmt(bud)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Ano ant.</p>
                      <p className="font-semibold text-foreground tabular-nums">{fmt(prev)}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span>vs Ano ant.</span>
                    <VariationPill value={variation(cur, prev)} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px]">
                    <span>vs Orçado</span>
                    <VariationPill value={variation(cur, bud)} />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
            <Card className="p-4 shadow-soft">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">Linhas da DRE</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{selectedIds.size} selecionada{selectedIds.size === 1 ? "" : "s"}</span>
                  {selectedIds.size > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedIds(new Set())}>
                      Limpar
                    </Button>
                  )}
                </div>
              </div>
              <div className="max-h-[620px] overflow-auto pr-1">
                {dataset?.tree
                  .filter((n) => n.id.startsWith("fixed:"))
                  .map((node) => (
                    <TreeLine key={node.id} node={node} selectedIds={selectedIds} select={selectLine} />
                  ))}
              </div>
            </Card>

            <Card className="p-4 shadow-soft space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup
                  type="single"
                  value={viewMode}
                  onValueChange={(v) => v && setViewMode(v as "chart" | "table")}
                  size="sm"
                  variant="outline"
                >
                  <ToggleGroupItem value="chart" aria-label="Gráfico">
                    <LineChartIcon className="h-4 w-4 mr-1.5" /> Gráfico
                  </ToggleGroupItem>
                  <ToggleGroupItem value="table" aria-label="Tabela">
                    <TableIcon className="h-4 w-4 mr-1.5" /> Tabela
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {viewMode === "chart" ? (
                <>
              <div className="flex flex-wrap items-center gap-3">
                {(["current", "budget", "previous"] as DreSeriesKey[]).map((key) => (
                  <Button key={key} size="sm" variant={visible[key] ? "default" : "outline"} onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}>{chartConfig[key].label}</Button>
                ))}
                <Select value={divider} onValueChange={setDivider}>
                  <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem divisor</SelectItem>
                    <SelectItem value="roomnights">÷ Room Nights</SelectItem>
                    <SelectItem value="uhs">÷ UHs Disponíveis</SelectItem>
                    <SelectItem value="revenue">÷ Receita Bruta Total</SelectItem>
                    <SelectItem value="netprofit">÷ Lucro Líquido</SelectItem>
                    <SelectItem value="lodging">÷ Receita de Hospedagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-6 text-xs text-muted-foreground">
                {visible.current && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-0.5 w-6 rounded-full inline-block" style={{ background: "#1D4ED8" }} />
                    Realizado
                  </div>
                )}
                {visible.budget && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-0.5 w-6 rounded-full inline-block" style={{ background: "#16A34A" }} />
                    Orçado
                  </div>
                )}
                {visible.previous && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-0.5 w-6 rounded-full inline-block" style={{ background: "#9CA3AF" }} />
                    Ano Anterior
                  </div>
                )}
              </div>
              {selectedNodes.length > 2 && (
                <p className="text-[11px] text-muted-foreground">
                  Máximo de 2 gráficos: exibindo as 2 primeiras linhas selecionadas.
                </p>
              )}
              {chartGroups.map((group) => {
                const formatChartValue = makeChartFormatter(group.lines);
                return (
                <div key={group.key} className="space-y-1">
                  {group.title && (
                    <p className="text-xs font-semibold text-foreground/80">
                      {group.title}
                      {group.isExpense && (
                        <span className="ml-2 font-normal text-muted-foreground">eixo invertido (despesa)</span>
                      )}
                    </p>
                  )}
                  <ChartContainer
                    config={chartConfig}
                    className={`${chartGroups.length > 1 ? "h-[260px]" : "h-[440px]"} w-full aspect-auto`}
                  >
                    <LineChart data={buildChartData(group.lines)} margin={{ left: 12, right: 20, top: 12, bottom: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} />
                      <YAxis
                        reversed={group.isExpense}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                        tickFormatter={(v) => formatChartValue(v)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => (
                              <>
                                <span className="text-muted-foreground">{chartConfig[String(name) as DreSeriesKey]?.label ?? String(name)}</span>
                                <span className="ml-auto font-mono font-medium tabular-nums text-foreground">{formatChartValue(value)}</span>
                              </>
                            )}
                          />
                        }
                      />
                      {visible.current  && (
                        <Line type="monotone" dataKey="current"  stroke="#1D4ED8" strokeWidth={3} dot={{ r: 3, fill: "#1D4ED8" }} connectNulls={false} />
                      )}
                      {visible.budget   && (
                        <Line type="monotone" dataKey="budget"   stroke="#16A34A" strokeWidth={2} dot={{ r: 3, fill: "#16A34A" }} connectNulls={false} strokeDasharray="5 3" />
                      )}
                      {visible.previous && (
                        <Line type="monotone" dataKey="previous" stroke="#9CA3AF" strokeWidth={2} dot={{ r: 3, fill: "#9CA3AF" }} connectNulls={false} strokeDasharray="3 3" />
                      )}
                    </LineChart>
                  </ChartContainer>
                </div>
                );
              })}
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {selectedNodes.length === 0
                      ? "Selecione uma ou mais linhas da DRE para visualizar a tabela comparativa."
                      : `${periodLabel} · ${selectedNodes.length} linha${selectedNodes.length === 1 ? "" : "s"}`}
                  </p>
                  {selectedNodes.length > 0 && (
                    <div className="rounded-md border overflow-auto max-h-[520px]">
                      <Table>
                        <TableHeader className="bg-muted/40 sticky top-0">
                          <TableRow>
                            <TableHead className="w-[40%]">Linha</TableHead>
                            <TableHead className="text-right">Realizado</TableHead>
                            <TableHead className="text-right">Orçado</TableHead>
                            <TableHead className="text-right">vs Orç.</TableHead>
                            <TableHead className="text-right">Ano Anterior</TableHead>
                            <TableHead className="text-right">vs Ano Ant.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedNodes.map((node) => (
                            <DreComparativeRow
                              key={node.id}
                              node={node}
                              depth={0}
                              months={monthsWindow}
                              expanded={expandedRows}
                              isExpense={isExpenseNode(node)}
                              toggle={(id) =>
                                setExpandedRows((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(id)) next.delete(id);
                                  else next.add(id);
                                  return next;
                                })
                              }
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}