import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function describeMonths(months: number[], year: number) {
  if (months.length === 0) return "Nenhum mês";
  if (months.length === 12) return `Ano todo de ${year}`;
  const sorted = [...months].sort((a, b) => a - b);
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  if (sorted.length === 1) return `${MONTHS_SHORT[sorted[0] - 1]} de ${year}`;
  if (contiguous) return `${MONTHS_SHORT[sorted[0] - 1]}–${MONTHS_SHORT[sorted[sorted.length - 1] - 1]} de ${year} (${sorted.length} meses)`;
  return `${sorted.map((m) => MONTHS_SHORT[m - 1]).join(" + ")} de ${year}`;
}

/** Barra única de período: Ano + meses marcáveis (vale para as três abas). */
export function PeriodBar({
  year, setYear, months, setMonths, years, hideYear = false,
}: {
  hideYear?: boolean;
  year: number;
  setYear: (y: number) => void;
  months: number[];
  setMonths: (m: number[]) => void;
  years: number[];
}) {
  const toggle = (m: number) => {
    const next = months.includes(m) ? months.filter((x) => x !== m) : [...months, m];
    if (next.length === 0) return; // sempre pelo menos 1 mês
    setMonths(next.sort((a, b) => a - b));
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
      {!hideYear && <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
        <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
        <SelectContent className="bg-popover">
          {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Meses">
        {MONTHS_SHORT.map((label, i) => {
          const m = i + 1;
          const on = months.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(m)}
              className={cn(
                "h-8 min-w-[44px] rounded-md border px-2 text-xs font-medium transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMonths(Array.from({ length: 12 }, (_, i) => i + 1))}>Ano todo</Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMonths([months[months.length - 1] ?? 1])}>Só 1 mês</Button>
      </div>
      <span className="text-xs text-muted-foreground">{hideYear ? describeMonths(months, year).replace(/ de \d{4}/, "").replace("Ano todo", "Ano todo") : describeMonths(months, year)}</span>
    </div>
  );
}
