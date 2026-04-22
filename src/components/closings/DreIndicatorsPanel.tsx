import { Card } from "@/components/ui/card";
import { useDreIndicators } from "@/hooks/useDre";
import type { IndicatorKey } from "@/lib/dreParser";
import { INDICATOR_LABELS, formatIndicator } from "@/lib/dreParser";
import { TrendingUp } from "lucide-react";

const ORDER: IndicatorKey[] = [
  "ocupacao", "adr", "revpar", "roomnights",
  "receita_bruta_total", "receita_liquida_total", "gop", "lucro_liquido",
];

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

  const visible = ORDER.filter((k) => cur.has(k));
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
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INDICATOR_LABELS[k]}</p>
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {formatIndicator(k, cur.get(k) ?? null)}
            </p>
            {prev.has(k) && (
              <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                Ano anterior: <span className="font-medium text-foreground/70">{formatIndicator(k, prev.get(k) ?? null)}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}