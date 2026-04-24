import { Card } from "@/components/ui/card";
import { useDreIndicators } from "@/hooks/useDre";
import type { IndicatorKey } from "@/lib/dreParser";
import { INDICATOR_LABELS, formatIndicator } from "@/lib/dreParser";
import { TrendingUp } from "lucide-react";

type DisplayKey = IndicatorKey | "gop_margin" | "net_margin";

const ORDER: DisplayKey[] = [
  "ocupacao", "adr", "revpar", "roomnights",
  "receita_bruta_total", "gop", "gop_margin", "lucro_liquido", "net_margin",
];

const DISPLAY_LABELS: Record<DisplayKey, string> = {
  ...INDICATOR_LABELS,
  gop_margin: "%GOP",
  net_margin: "Margem Líquida %",
};

function variation(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatValue(key: DisplayKey, value: number | null) {
  if (key === "gop_margin" || key === "net_margin") {
    return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
  }
  return formatIndicator(key, value);
}

export function DreIndicatorsPanel({ closingId }: { closingId: string }) {
  const { data = [], isLoading } = useDreIndicators(closingId);

  if (isLoading) return null;
  if (data.length === 0) return null;

  // Indicadores correntes: [key] Label   |   Ano anterior: [prev_key]
  const cur = new Map<IndicatorKey, number | null>();
  const prev = new Map<IndicatorKey, number | null>();
  for (const row of data) {
    const mp = /^\[prev_(\w+)\]/.exec(row.line_label);
    if (mp) { prev.set(mp[1] as IndicatorKey, row.line_value); continue; }
    const m = /^\[(\w+)\]/.exec(row.line_label);
    if (m) cur.set(m[1] as IndicatorKey, row.line_value);
  }

  const calcCur = new Map<DisplayKey, number | null>(cur);
  const calcPrev = new Map<DisplayKey, number | null>(prev);
  const currentRevenue = cur.get("receita_bruta_total") ?? null;
  const previousRevenue = prev.get("receita_bruta_total") ?? null;
  if (currentRevenue) calcCur.set("gop_margin", ((cur.get("gop") ?? 0) / currentRevenue) * 100);
  if (previousRevenue) calcPrev.set("gop_margin", ((prev.get("gop") ?? 0) / previousRevenue) * 100);
  if (currentRevenue && cur.get("lucro_liquido") != null) calcCur.set("net_margin", ((cur.get("lucro_liquido") ?? 0) / currentRevenue) * 100);
  if (previousRevenue && prev.get("lucro_liquido") != null) calcPrev.set("net_margin", ((prev.get("lucro_liquido") ?? 0) / previousRevenue) * 100);

  const visible = ORDER.filter((k) => calcCur.has(k));
  if (visible.length === 0) return null;

  return (
    <Card className="p-5 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">Indicadores extraídos</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((k) => (
          <div key={k} className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{DISPLAY_LABELS[k]}</p>
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {formatValue(k, calcCur.get(k) ?? null)}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
              Ano anterior: <span className="font-medium text-foreground/70">{formatValue(k, calcPrev.get(k) ?? null)}</span>
            </p>
            {variation(calcCur.get(k), calcPrev.get(k)) != null && (
              <p className={`text-[10px] font-semibold tabular-nums ${variation(calcCur.get(k), calcPrev.get(k))! >= 0 ? "text-success" : "text-destructive"}`}>
                {variation(calcCur.get(k), calcPrev.get(k))! >= 0 ? "+" : ""}{variation(calcCur.get(k), calcPrev.get(k))!.toFixed(1).replace(".", ",")}%
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}