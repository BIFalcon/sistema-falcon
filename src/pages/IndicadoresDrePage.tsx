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
    denLabels: ["RECEITA LÍQUIDA TOTAL", "Receita Líquida Total", "RECEITA BRUTA TOTAL"],
  },
  {
    title: "Margem Líquida",
    format: "pct",
    agg: "ratio",
    numLabels: ["Lucro / Prejuízo a Distribuir", "Lucro Líquido", "Resultado Líquido"],
    denLabels: ["RECEITA LÍQUIDA TOTAL", "Receita Líquida Total", "RECEITA BRUTA TOTAL"],
  },
];

type PeriodKey = "1" | "2" | "3" | "6" | "12";
const PERIOD_OPTIONS: { value: PeriodKey; label: string; months: number }[] = [
  { value: "1", label: "Mensal", months: 1 },
  { value: "2", label: "Bimestral", months: 2 },
  { value: "3", label: "Trimestral", months: 3 },
  { value: "6", label: "Semestral", months: 6 },
  { value: "12", label: "Anual", months: 12 },
];

const chartConfig = {
  current: { label: "Realizado", color: "hsl(var(--primary))" },
  budget: { label: "Orçado", color: "hsl(var(--ring))" },
  previous: { label: "Ano Anterior", color: "hsl(var(--muted-foreground))" },
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

function computeCardValue(
  card: CardDef,
  dataset: ReturnType<typeof useDreAnalytics>["data"],
  months: number[],
  series: DreSeriesKey,
): number | null {
  if (card.agg === "ratio") {
    const num = pickLine(dataset, card.numLabels);
    const den = pickLine(dataset, card.denLabels);
    if (!num || !den) return null;
    return aggregateRatio(num.series[series], den.series[series], months);
  }
  const line = pickLine(dataset, card.labels);
  if (!line) return null;
  const v = aggregateSeries(line.series[series], months, card.agg);
  if (v == null) return null;
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

function TreeLine({ node, selected, toggle }: { node: DreLineNode; selected: Set<string>; toggle: (id: string) => void }) {
  const [open, setOpen] = useState(node.level === 1);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/70" style={{ paddingLeft: `${(node.level - 1) * 16 + 8}px` }}>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen((v) => !v)} disabled={!hasChildren}>
          {hasChildren ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : <span />}
        </Button>
        <Checkbox checked={selected.has(node.id)} onCheckedChange={() => toggle(node.id)} />
        <span className={node.level === 1 ? "text-sm font-semibold" : "text-sm text-foreground"}>{node.label}</span>
      </div>
      {open && node.children.map((child) => <TreeLine key={child.id} node={child} selected={selected} toggle={toggle} />)}
    </div>
  );
}

export default function IndicadoresDrePage() {
  const { allowedHotels, isMaster, user } = useAuth();
  const { hotelId, month, year } = useFilters();
  const queryClient = useQueryClient();
  const [retroOpen, setRetroOpen] = useState(false);
  const [retroHotelId, setRetroHotelId] = useState<string>("");
  const [retroYear, setRetroYear] = useState<number>(new Date().getFullYear());
  const [retroUpToMonth, setRetroUpToMonth] = useState<number>(12);
  const [retroFile, setRetroFile] = useState<File | null>(null);
  const [retroSubmitting, setRetroSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<DreSeriesKey, boolean>>({ current: true, budget: true, previous: true });
  const [metric, setMetric] = useState("value");
  const [divider, setDivider] = useState("none");
  const [period, setPeriod] = useState<PeriodKey>("1");
  const hotelIds = useMemo(() => (hotelId ? [hotelId] : allowedHotels.map((h) => h.id)), [allowedHotels, hotelId]);
  const periodCfg = PERIOD_OPTIONS.find((p) => p.value === period) ?? PERIOD_OPTIONS[0];
  const { data: dataset, isLoading } = useDreAnalytics({
    hotelIds,
    year,
    month,
    periodMonths: periodCfg.months,
  });

  const selectedLines = useMemo(() => dataset?.flat.filter((line) => selectedIds.has(line.id)) ?? [], [dataset, selectedIds]);
  const divisorLine = useMemo(() => {
    if (!dataset || divider === "none") return undefined;
    if (divider === "roomnights") return findDreLine(dataset, "Apartamentos ocupados");
    if (divider === "uhs") return findDreLine(dataset, "Número de apartamentos disponíveis");
    return findDreLine(dataset, "RECEITA BRUTA TOTAL");
  }, [dataset, divider]);
  const chartData = useMemo(() => {
    const base = {
      current: divideSeries(sumSeries(selectedLines, "current"), divisorLine, "current"),
      budget: divideSeries(sumSeries(selectedLines, "budget"), divisorLine, "budget"),
      previous: divideSeries(sumSeries(selectedLines, "previous"), divisorLine, "previous"),
    };
    return MONTHS_SHORT.map((m, i) => ({
      month: m,
      current: metric === "mom" ? variation(base.current[i], base.current[i - 1]) : metric === "yoy" ? variation(base.current[i], base.previous[i]) : metric === "budget" ? variation(base.current[i], base.budget[i]) : base.current[i],
      budget: base.budget[i],
      previous: base.previous[i],
    }));
  }, [selectedLines, divisorLine, metric]);
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
                {(() => {
                  const kpiNodes = dataset?.tree.filter((n) =>
                    /^\d+:[a-z_]+$/.test(n.id)
                  ) ?? [];
                  const dreNodes = dataset?.tree.filter((n) =>
                    !/^\d+:[a-z_]+$/.test(n.id)
                  ) ?? [];
                  return (
                    <>
                      {kpiNodes.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-3 pb-1">
                            Indicadores principais
                          </p>
                          {kpiNodes.map((node) => (
                            <TreeLine key={node.id} node={node} selected={selectedIds} toggle={toggleLine} />
                          ))}
                        </div>
                      )}
                      {dreNodes.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-3 pb-1">
                            Linhas da DRE
                          </p>
                          {dreNodes.map((node) => (
                            <TreeLine key={node.id} node={node} selected={selectedIds} toggle={toggleLine} />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>

            <Card className="p-4 shadow-soft space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {(["current", "budget", "previous"] as DreSeriesKey[]).map((key) => (
                  <Button key={key} size="sm" variant={visible[key] ? "default" : "outline"} onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}>{chartConfig[key].label}</Button>
                ))}
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="value">Valores mensais</SelectItem><SelectItem value="mom">Variação mês a mês</SelectItem><SelectItem value="yoy">Variação ano a ano</SelectItem><SelectItem value="budget">Variação vs Orçado</SelectItem></SelectContent>
                </Select>
                <Select value={divider} onValueChange={setDivider}>
                  <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sem divisor</SelectItem><SelectItem value="roomnights">÷ Room Nights</SelectItem><SelectItem value="uhs">÷ UHs Disponíveis</SelectItem><SelectItem value="revenue">÷ Receita Bruta Total</SelectItem></SelectContent>
                </Select>
              </div>
              <ChartContainer config={chartConfig} className="h-[440px] w-full aspect-auto">
                <LineChart data={chartData} margin={{ left: 12, right: 20, top: 12, bottom: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => metric === "value" ? Number(v).toLocaleString("pt-BR") : `${Number(v).toFixed(0)}%`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {visible.current && <Line type="monotone" dataKey="current" stroke="var(--color-current)" strokeWidth={3} dot={false} connectNulls={false} />}
                  {visible.budget && <Line type="monotone" dataKey="budget" stroke="var(--color-budget)" strokeWidth={2} dot={false} connectNulls={false} />}
                  {visible.previous && <Line type="monotone" dataKey="previous" stroke="var(--color-previous)" strokeWidth={2} dot={false} connectNulls={false} />}
                </LineChart>
              </ChartContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}