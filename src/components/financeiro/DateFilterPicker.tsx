/**
 * Calendário avançado para filtro de Contas a Pagar.
 * Dois modos:
 *  - "range": seleciona início + fim de um período
 *  - "specific": seleciona dias individuais (multi-seleção)
 */
import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

export type DateFilterMode = "range" | "specific";

interface Props {
  dateFrom: string;
  dateTo: string;
  specificDates: string[];
  onChangeRange: (from: string, to: string) => void;
  onChangeSpecific: (dates: string[]) => void;
}

const toIso = (d: Date) => format(d, "yyyy-MM-dd");
const fromIso = (s: string): Date | undefined => {
  if (!s) return undefined;
  const d = parse(s, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};

export function DateFilterPicker({
  dateFrom,
  dateTo,
  specificDates,
  onChangeRange,
  onChangeSpecific,
}: Props) {
  const hasSpecific = specificDates.length > 0;
  const [mode, setMode] = useState<DateFilterMode>(hasSpecific ? "specific" : "range");

  const range: DateRange | undefined = (() => {
    const from = fromIso(dateFrom);
    const to = fromIso(dateTo);
    if (!from && !to) return undefined;
    return { from, to };
  })();

  const selectedSpecific = specificDates
    .map((d) => fromIso(d))
    .filter((d): d is Date => !!d);

  const label = (() => {
    if (hasSpecific) {
      if (selectedSpecific.length === 1) return format(selectedSpecific[0], "dd/MM/yyyy");
      return `${selectedSpecific.length} dias selecionados`;
    }
    const f = fromIso(dateFrom);
    const t = fromIso(dateTo);
    if (f && t) {
      if (toIso(f) === toIso(t)) return format(f, "dd/MM/yyyy");
      return `${format(f, "dd/MM/yy")} → ${format(t, "dd/MM/yy")}`;
    }
    if (f) return `desde ${format(f, "dd/MM/yy")}`;
    if (t) return `até ${format(t, "dd/MM/yy")}`;
    return "Selecionar período";
  })();

  const hasAny = hasSpecific || !!dateFrom || !!dateTo;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-9 justify-start font-normal", !hasAny && "text-muted-foreground")}
          >
            <CalendarIcon className="h-4 w-4 mr-2" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 space-y-2" align="start">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "range" ? "default" : "outline"}
              onClick={() => {
                setMode("range");
                onChangeSpecific([]);
              }}
            >
              Período
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "specific" ? "default" : "outline"}
              onClick={() => {
                setMode("specific");
                onChangeRange("", "");
              }}
            >
              Dias específicos
            </Button>
          </div>
          {mode === "range" && (
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">De</span>
                <Input
                  type="date"
                  className="h-8 w-[150px] text-xs"
                  value={dateFrom}
                  onChange={(e) => onChangeRange(e.target.value, dateTo || e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">até</span>
                <Input
                  type="date"
                  className="h-8 w-[150px] text-xs"
                  value={dateTo}
                  onChange={(e) => onChangeRange(dateFrom || e.target.value, e.target.value)}
                />
              </label>
            </div>
          )}
          {mode === "range" ? (
            <Calendar
              mode="range"
              locale={ptBR}
              selected={range}
              onSelect={(r) => {
                onChangeRange(r?.from ? toIso(r.from) : "", r?.to ? toIso(r.to) : (r?.from ? toIso(r.from) : ""));
              }}
              numberOfMonths={2}
              className={cn("p-0 pointer-events-auto")}
            />
          ) : (
            <Calendar
              mode="multiple"
              locale={ptBR}
              selected={selectedSpecific}
              onSelect={(dates) => {
                onChangeSpecific((dates ?? []).map(toIso).sort());
              }}
              numberOfMonths={2}
              className={cn("p-0 pointer-events-auto")}
            />
          )}
        </PopoverContent>
      </Popover>
      {hasAny && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          onClick={() => {
            onChangeRange("", "");
            onChangeSpecific([]);
          }}
          title="Limpar datas"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}