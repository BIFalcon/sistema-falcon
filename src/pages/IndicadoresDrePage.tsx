import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, LineChart as LineChartIcon, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useDreAnalytics } from "@/hooks/useDre";
import { findDreLine, type DreLineNode, type DreMonthValue, type DreSeriesKey } from "@/lib/dreAnalytics";
import { MONTHS_PT } from "@/lib/constants";

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const CARD_LINES = [
  { title: "Taxa de Ocupação", labels: ["Taxa de Ocupação"] },
  { title: "ADR", labels: ["Diária Média", "ADR"] },
  { title: "RevPAR", labels: ["RevPAR"] },
  { title: "GOP", labels: ["GOP", "Resultado Operacional Bruto"] },
];
const chartConfig = {
  current: { label: "Realizado", color: "hsl(var(--primary))" },
  budget: { label: "Orçado", color: "hsl(var(--ring))" },
  previous: { label: "Ano Anterior", color: "hsl(var(--muted-foreground))" },
} satisfies ChartConfig;

function brl(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
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
  const [open, setOpen] = useState(node.level < 2);
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
  const { allowedHotels, isMaster } = useAuth();
  const { hotelId, month, year } = useFilters();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<DreSeriesKey, boolean>>({ current: true, budget: true, previous: true });
  const [metric, setMetric] = useState("value");
  const [divider, setDivider] = useState("none");
  const hotelIds = useMemo(() => (hotelId ? [hotelId] : allowedHotels.map((h) => h.id)), [allowedHotels, hotelId]);
  const { data: dataset, isLoading } = useDreAnalytics({ hotelIds, year });

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

  return (
    <div className="space-y-6 max-w-[1500px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Análise</p>
          <h1 className="text-2xl font-semibold text-foreground">Indicadores DRE</h1>
          <p className="text-sm text-muted-foreground">{hotelId ? "Hotel selecionado" : `${hotelIds.length} hotéis`} · {month === 0 ? "Acumulado do ano" : MONTHS_PT[month - 1]} de {year}</p>
        </div>
        {isMaster && (
          <Button asChild variant="outline" size="sm">
            <Link to="/configuracoes/dre-retroativo">
              <Upload className="h-4 w-4 mr-2" />
              Upload retroativo
            </Link>
          </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {CARD_LINES.map((card) => {
              const line = card.labels.map((label) => findDreLine(dataset ?? undefined, label)).find(Boolean);
              const cur = line ? valueAt(line.series.current, month) : null;
              const bud = line ? valueAt(line.series.budget, month) : null;
              const prev = line ? valueAt(line.series.previous, month) : null;
              return (
                <Card key={card.title} className="p-4 shadow-soft">
                  <h3 className="text-sm font-semibold mb-3">{card.title}</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Realizado</p><p className="font-semibold text-foreground">{card.title === "Taxa de Ocupação" ? pct(cur && cur <= 1 ? cur * 100 : cur) : brl(cur)}</p></div>
                    <div><p className="text-muted-foreground">Orçado</p><p className="font-semibold text-foreground">{card.title === "Taxa de Ocupação" ? pct(bud && bud <= 1 ? bud * 100 : bud) : brl(bud)}</p></div>
                    <div><p className="text-muted-foreground">Ano ant.</p><p className="font-semibold text-foreground">{card.title === "Taxa de Ocupação" ? pct(prev && prev <= 1 ? prev * 100 : prev) : brl(prev)}</p></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs"><span>vs Ano ant.</span><VariationPill value={variation(cur, prev)} /></div>
                  <div className="mt-1 flex items-center justify-between text-xs"><span>vs Orçado</span><VariationPill value={variation(cur, bud)} /></div>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
            <Card className="p-4 shadow-soft">
              <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold uppercase tracking-wider">Linhas da DRE</h3><span className="text-xs text-muted-foreground">{selectedIds.size} selecionadas</span></div>
              <div className="max-h-[620px] overflow-auto pr-1">
                {dataset?.tree.map((node) => <TreeLine key={node.id} node={node} selected={selectedIds} toggle={toggleLine} />)}
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