import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, LineChart as LineChartIcon, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useDreAnalytics } from "@/hooks/useDre";
import { useGopManagers } from "@/hooks/useGopManagers";
import { findDreLine, type DreLineNode, type DreMonthValue, type DreSeriesKey } from "@/lib/dreAnalytics";
import { MONTHS_PT } from "@/lib/constants";
import { fmtBRL } from "@/lib/formatters";
import { uploadRetroactiveDre } from "@/lib/retroactiveDreUpload";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

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
  { title: "GOP", format: "brl", agg: "sum", labels: ["GOP", "Resultado Operacional Bruto"] },
  {
    title: "%GOP",
    format: "pct",
    agg: "ratio",
    numLabels: ["GOP", "Resultado Operacional Bruto"],
    denLabels: ["Receita Bruta Total", "RECEITA BRUTA TOTAL", "Receita Total Bruta"],
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

function VariationPill({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value >= 0 ? "text-success" : "text-destructive"}>{value >= 0 ? "+" : ""}{pct(value)}</span>;
}

function TreeLine({ node, selectedId, select }: { node: DreLineNode; selectedId: string | null; select: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const isSelectable = !hasChildren;
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
          <Checkbox checked={selectedId === node.id} onCheckedChange={() => select(node.id)} />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className={fontClass}>{node.label}</span>
      </div>
      {open && node.children.map((child) => <TreeLine key={child.id} node={child} selectedId={selectedId} select={select} />)}
    </div>
  );
}

export default function IndicadoresDrePage() {
  const { allowedHotels, isMaster, user } = useAuth();
  const { hotelId, hotelIds: selectedHotelIds, gopId, month, year, setHotelId } = useFilters();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<DreSeriesKey, boolean>>({ current: true, budget: true, previous: true });
  
  const [divider, setDivider] = useState("none");
  const [period, setPeriod] = useState<PeriodKey>("1");
  const showAsPct = divider === "revenue";
  const hotelIds = useMemo(() => {
    if (selectedHotelIds && selectedHotelIds.length > 0) return selectedHotelIds;
    if (hotelId) return [hotelId];
    return hotelOptions.map((h) => h.id);
  }, [hotelOptions, hotelId, selectedHotelIds]);
  const periodCfg = PERIOD_OPTIONS.find((p) => p.value === period) ?? PERIOD_OPTIONS[0];
  const { data: dataset, isLoading } = useDreAnalytics({
    hotelIds,
    year,
    month,
    periodMonths: periodCfg.months,
  });

  // Expande nós selecionados: se um pai for selecionado e tiver
  // série vazia, substitui pelos descendentes com dados reais.
  const selectedLines = useMemo(() => {
    if (!dataset) return [];
    function getLeaves(node: DreLineNode): DreLineNode[] {
      if (node.children.length === 0) return [node];
      const childLeaves = node.children.flatMap(getLeaves);
      // Se o nó pai tem dados próprios (série não toda nula), inclui ele
      const hasSeries = node.series.current.some((v) => v != null);
      return hasSeries ? [node] : childLeaves;
    }
    const result: DreLineNode[] = [];
    const seen = new Set<string>();
    for (const id of selectedIds) {
      const node = dataset.flat.find((n) => n.id === id);
      if (!node) continue;
      for (const leaf of getLeaves(node)) {
        if (!seen.has(leaf.id)) {
          seen.add(leaf.id);
          result.push(leaf);
        }
      }
    }
    return result;
  }, [dataset, selectedIds]);
  const divisorLine = useMemo(() => {
    if (!dataset || divider === "none") return undefined;
    if (divider === "roomnights") return findDreLine(dataset, "Apartamentos ocupados");
    if (divider === "uhs") return findDreLine(dataset, "Número de apartamentos disponíveis");
    return findDreLine(dataset, "RECEITA BRUTA TOTAL");
  }, [dataset, divider]);
  const chartData = useMemo(() => {
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

    const lineAgg = selectedLines.length > 0 ? getAggType(selectedLines[0].label) : "sum";

    const rnNode = findDreLine(dataset ?? undefined, "Apartamentos ocupados")
      ?? findDreLine(dataset ?? undefined, "Apartamentos Ocupados")
      ?? findDreLine(dataset ?? undefined, "Room Nights");

    const baseCurrent = divideSeries(aggregateSelectedSeries(selectedLines, "current", dataset), divisorLine, "current");
    const baseBudget = divideSeries(aggregateSelectedSeries(selectedLines, "budget", dataset), divisorLine, "budget");
    const basePrevious = divideSeries(aggregateSelectedSeries(selectedLines, "previous", dataset), divisorLine, "previous");

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
  }, [selectedLines, divisorLine, periodCfg, dataset, year]);
  const isExpenseLine = selectedLines.some((l) =>
    /despesa|dedu[çc]|custo|encargo|imposto|taxa.*adm|aluguel/i.test(l.label) ||
    l.series.current.filter((v) => v != null && v < 0).length >
    l.series.current.filter((v) => v != null && v > 0).length
  );
  const toggleLine = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const monthsWindow = useMemo(
    () => periodMonths(month, periodCfg.months),
    [month, periodCfg.months],
  );
  const periodLabel = useMemo(() => {
    if (monthsWindow.length === 12) return `Acumulado de ${year}`;
    if (monthsWindow.length === 1) return `${MONTHS_PT[monthsWindow[0] - 1]} de ${year}`;
    const first = MONTHS_PT[monthsWindow[0] - 1];
    const last = MONTHS_PT[monthsWindow[monthsWindow.length - 1] - 1];
    return `${first}–${last} de ${year}`;
  }, [monthsWindow, year]);

  return (
    <div className="space-y-6 max-w-[1500px]">
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
                  <Label htmlFor="retro-file">Arquivo da DRE (.xlsx)</Label>
                  <Input
                    id="retro-file"
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => setRetroFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={retroSubmitting || !retroHotelId || !retroFile || !user}
                  onClick={async () => {
                    if (!user || !retroHotelId || !retroFile) return;
                    setRetroSubmitting(true);
                    try {
                      const res = await uploadRetroactiveDre({
                        hotelId: retroHotelId,
                        year: retroYear,
                        file: retroFile,
                        userId: user.id,
                        upToMonth: retroUpToMonth,
                      });
                      toast({
                        title: "DRE enviada",
                        description: res.monthsProcessed.length > 0
                          ? `${res.monthsProcessed.length} mês(es) processado(s): ${res.monthsProcessed.map((m) => MONTHS_PT[m - 1]).join(", ")}`
                          : "Nenhum mês com dados encontrado.",
                      });
                      setRetroFile(null);
                      setRetroOpen(false);
                      queryClient.invalidateQueries({ queryKey: ["dre-analytics"] });
                    } catch (err) {
                      toast({
                        title: "Erro no upload",
                        description: err instanceof Error ? err.message : "Falha desconhecida",
                        variant: "destructive",
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

      {!dataset && !isLoading ? (
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
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {CARD_LINES.map((card) => {
              const cur = computeCardValue(card, dataset, monthsWindow, "current");
              const bud = computeCardValue(card, dataset, monthsWindow, "budget");
              const prev = computeCardValue(card, dataset, monthsWindow, "previous");
              const fmt = (v: number | null) =>
                card.format === "pct" ? pct(v) : fmtBRL(v);
              return (
                <Card key={card.title} className="p-4 shadow-soft">
                  <h3 className="text-sm font-semibold mb-3">{card.title}</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Realizado</p>
                      <p className="font-semibold text-foreground">{fmt(cur)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Orçado</p>
                      <p className="font-semibold text-foreground">{fmt(bud)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Ano ant.</p>
                      <p className="font-semibold text-foreground">{fmt(prev)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span>vs Ano ant.</span>
                    <VariationPill value={variation(cur, prev)} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span>vs Orçado</span>
                    <VariationPill value={variation(cur, bud)} />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
            <Card className="p-4 shadow-soft">
              <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold uppercase tracking-wider">Linhas da DRE</h3><span className="text-xs text-muted-foreground">{selectedIds.size} selecionadas</span></div>
              <div className="max-h-[620px] overflow-auto pr-1">
                {dataset?.tree
                  .filter((n) => n.id.startsWith("fixed:"))
                  .map((node) => (
                    <TreeLine key={node.id} node={node} selected={selectedIds} toggle={toggleLine} />
                  ))}
              </div>
            </Card>

            <Card className="p-4 shadow-soft space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {(["current", "budget", "previous"] as DreSeriesKey[]).map((key) => (
                  <Button key={key} size="sm" variant={visible[key] ? "default" : "outline"} onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}>{chartConfig[key].label}</Button>
                ))}
                <Select value={divider} onValueChange={setDivider}>
                  <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sem divisor</SelectItem><SelectItem value="roomnights">÷ Room Nights</SelectItem><SelectItem value="uhs">÷ UHs Disponíveis</SelectItem><SelectItem value="revenue">÷ Receita Bruta Total</SelectItem></SelectContent>
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
              <ChartContainer config={chartConfig} className="h-[440px] w-full aspect-auto">
                <LineChart data={chartData} margin={{ left: 12, right: 20, top: 12, bottom: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    reversed={isExpenseLine}
                    tickFormatter={(v) => {
                      const abs = Math.abs(Number(v));
                      if (showAsPct) return `${(abs * 100).toFixed(1)}%`;
                      const isPct = selectedLines.some((l) =>
                        /taxa\s*de\s*ocupa|%\s*gop|margem|fator\s*de\s*ocupa/i.test(l.label)
                      );
                      if (isPct) return `${(abs * (abs <= 1 ? 100 : 1)).toFixed(1)}%`;
                      return abs.toLocaleString("pt-BR", { notation: "compact" });
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          showAsPct
                            ? `${(Number(value) * 100).toFixed(2)}%`
                            : Number(value).toLocaleString("pt-BR")
                        }
                      />
                    }
                  />
                  {visible.current  && <Line type="monotone" dataKey="current"  stroke="#1D4ED8" strokeWidth={3} dot={false} connectNulls={false} />}
                  {visible.budget   && <Line type="monotone" dataKey="budget"   stroke="#16A34A" strokeWidth={2} dot={false} connectNulls={false} strokeDasharray="5 3" />}
                  {visible.previous && <Line type="monotone" dataKey="previous" stroke="#9CA3AF" strokeWidth={2} dot={false} connectNulls={false} strokeDasharray="3 3" />}
                </LineChart>
              </ChartContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}