import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDreAnalytics } from "@/hooks/useDre";
import { RATIO_SPECS, computeIndicator, formatIndicator } from "@/lib/dreIndicatorCatalog";

type HotelLite = { id: string; name: string; brand?: string | null };

function brandGroup(h: HotelLite): string {
  const s = `${h.brand ?? ""} ${h.name}`.toLowerCase();
  if (s.includes("styles")) return "ibis Styles";
  if (s.includes("budget")) return "ibis budget";
  if (s.includes("ibis")) return "ibis";
  return "Outros";
}

function HotelColumn({ hotelIds, year, months, title }: { hotelIds: string[]; year: number; months: number[]; title: string }) {
  const maxMonth = Math.max(...months);
  const { data, isLoading } = useDreAnalytics({ hotelIds, year, month: maxMonth, periodMonths: maxMonth });
  return (
    <div className="min-w-[150px] flex-1 border-l border-border">
      <div className="h-12 px-3 flex items-center text-xs font-semibold border-b border-border bg-muted/40 truncate" title={title}>{title}</div>
      {RATIO_SPECS.map((def) => {
        const v = isLoading ? null : computeIndicator(def, data?.flat, months);
        const text = isLoading ? "…" : formatIndicator(def, v);
        return (
          <div key={def.key} className={`h-10 px-3 flex items-center justify-end text-sm tabular-nums border-b border-border ${v == null ? "text-muted-foreground text-xs" : "text-foreground"}`}>
            {text}
          </div>
        );
      })}
    </div>
  );
}

export function ComparativoTab({ hotels, year, months, initial }: { hotels: HotelLite[]; year: number; months: number[]; initial: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial.length >= 2 ? initial : []);
  useEffect(() => { if (initial.length >= 2) setSelected(initial); }, [initial.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, HotelLite[]>();
    for (const h of hotels) {
      const g = brandGroup(h);
      m.set(g, [...(m.get(g) ?? []), h]);
    }
    return m;
  }, [hotels]);
  const toggle = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const chosen = hotels.filter((h) => selected.includes(h.id));

  return (
    <div className="space-y-4">
      <Card className="p-4 shadow-soft space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Agrupar</span>
          {[...groups.entries()].map(([g, hs]) => (
            <Button key={g} variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelected(hs.map((h) => h.id))}>
              {g} ({hs.length})
            </Button>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelected(hotels.map((h) => h.id))}>Todos</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>Limpar</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-1">
          {hotels.map((h) => (
            <label key={h.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted cursor-pointer">
              <Checkbox checked={selected.includes(h.id)} onCheckedChange={() => toggle(h.id)} />
              <span className="truncate">{h.name}</span>
            </label>
          ))}
        </div>
      </Card>

      {chosen.length < 2 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground shadow-soft">Marque 2 ou mais hotéis para comparar lado a lado.</Card>
      ) : (
        <Card className="shadow-soft overflow-x-auto">
          <div className="flex min-w-max">
            <div className="w-[230px] shrink-0 sticky left-0 bg-card z-10">
              <div className="h-12 px-3 flex items-center text-xs font-semibold border-b border-border bg-muted/40">Indicador</div>
              {RATIO_SPECS.map((def) => (
                <div key={def.key} className="h-10 px-3 flex flex-col justify-center border-b border-border">
                  <span className="text-sm leading-tight">{def.label}{def.aliases ? ` / ${def.aliases.join(" / ")}` : ""}</span>
                  {def.unavailableNote && <span className="text-[10px] text-muted-foreground leading-tight">{def.unavailableNote}</span>}
                </div>
              ))}
            </div>
            {chosen.map((h) => <HotelColumn key={h.id} hotelIds={[h.id]} year={year} months={months} title={h.name} />)}
            <HotelColumn hotelIds={chosen.map((h) => h.id)} year={year} months={months} title="Rede (seleção)" />
          </div>
        </Card>
      )}
    </div>
  );
}
