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

  // line_label tem prefixo "[key] Label original"
  const map = new Map<IndicatorKey, number | null>();
  for (const row of data) {
    const m = /^\[(\w+)\]/.exec(row.line_label);
    if (m) map.set(m[1] as IndicatorKey, row.line_value);
  }

  const visible = ORDER.filter((k) => map.has(k));
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
              {formatIndicator(k, map.get(k) ?? null)}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}