import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import panelGroups from "@/lib/drePanelGroups.json";
import {
  AB_REVENUE_LABELS, AVAILABLE_LABELS, BREAKFAST_COST_LABELS, CMV_LABELS, GOP_LABELS, GUESTS_LABELS,
  LABOR_LABELS, LODGING_LABELS, NET_PROFIT_LABELS, OCCUPIED_LABELS, REVENUE_LABELS, cleanLabel,
} from "@/lib/dreIndicatorCatalog";

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
type HotelLite = { id: string; name: string };
type Fmt = "brl" | "brl2" | "pct" | "int";

/** label limpo -> grupo do painel (vem da coluna "Grupo do painel" da base histórica). */
const GROUP_BY_LABEL = new Map<string, string>(
  Object.entries(panelGroups as Record<string, string>).map(([k, v]) => [cleanLabel(k), v]),
);
const TARIFF_GROUPS = ["Fees Accor", "Impostos s/ receita", "Comissões de cartão", "Comissões de agências"];

interface Period { key: string; label: string; ym: Array<[number, number]> }
/** valores por "ano-mês" -> label limpo -> valor */
type Store = Map<string, Map<string, number>>;

function useHistory(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["dre-history", hotelId],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dre_history" as never, { _hotel_id: hotelId } as never);
      if (error) throw error;
      return data as unknown as { lines: [number, number, string, number][]; entities: [string, number, number, string, string | null, number][] };
    },
  });
}

function fmt(v: number | null, f: Fmt) {
  if (v == null || !Number.isFinite(v)) return "sem dado";
  if (f === "pct") return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (f === "int") return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: f === "brl2" ? 2 : 0, maximumFractionDigits: f === "brl2" ? 2 : 0 });
}

export function HistoricoTab({ hotels, defaultHotelId, months }: { hotels: HotelLite[]; defaultHotelId: string | null; months: number[] }) {
  // Hotel vem do filtro global do topo (sem seletor duplicado aqui).
  const hotelId = defaultHotelId ?? hotels[0]?.id ?? null;
  const { data, isLoading } = useHistory(hotelId);
  // Anos ocultos pelo usuário; por padrão todos os anos com dado aparecem.
  const [hiddenYears, setHiddenYears] = useState<number[]>([]);

  const { store, years, groupStore } = useMemo(() => {
    const store: Store = new Map();
    const groupStore: Store = new Map();
    const years = new Set<number>();
    for (const [y, m, label, value] of data?.lines ?? []) {
      const k = `${y}-${m}`;
      years.add(y);
      const cl = cleanLabel(label);
      if (!store.has(k)) store.set(k, new Map());
      const row = store.get(k)!;
      if (!row.has(cl)) row.set(cl, Number(value));
      const g = GROUP_BY_LABEL.get(cl);
      if (g) {
        if (!groupStore.has(k)) groupStore.set(k, new Map());
        const gr = groupStore.get(k)!;
        gr.set(g, (gr.get(g) ?? 0) + Math.abs(Number(value)));
      }
    }
    return { store, years: [...years].sort(), groupStore };
  }, [data]);

  const allYm = useMemo(() => [...store.keys()].map((k) => k.split("-").map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [store]);
  const monthly = allYm.length > 0 && allYm.length < 13;
  const monthsSet = new Set(months);
  const periods: Period[] = monthly
    ? allYm.map(([y, m]) => ({ key: `${y}-${m}`, label: `${MONTHS_SHORT[m - 1]}/${String(y).slice(2)}`, ym: [[y, m]] }))
    : years.filter((y) => !hiddenYears.includes(y)).map((y) => ({ key: String(y), label: String(y), ym: allYm.filter(([yy, m]) => yy === y && monthsSet.has(m)) }));
  // Mês só conta se a DRE trouxe receita nele (meses futuros zerados não entram).
  const revCls = REVENUE_LABELS.map(cleanLabel);
  for (const p of periods) p.ym = p.ym.filter(([y, m]) => { const row = store.get(`${y}-${m}`); return !!row && revCls.some((c) => (row.get(c) ?? 0) !== 0); });

  const sum = (p: Period, labels: string[], abs = false): number | null => {
    const cls = labels.map(cleanLabel);
    let total = 0, any = false;
    for (const [y, m] of p.ym) {
      const row = store.get(`${y}-${m}`);
      if (!row) continue;
      for (const c of cls) {
        const v = row.get(c);
        if (v != null) { total += abs ? Math.abs(v) : v; any = true; break; }
      }
    }
    return any ? total : null;
  };
  /** Soma todas as linhas da lista (modelo antigo quebra encargos/benefícios em várias linhas). */
  const sumAll = (p: Period, labels: string[]): number | null => {
    let t = 0, any = false;
    for (const l of labels) { const v = sum(p, [l], true); if (v != null) { t += v; any = true; } }
    return any ? t : null;
  };
  /** UHs disponíveis; no modelo antigo (sem a linha) deriva de Roomnights ÷ Taxa de Ocupação, mês a mês. */
  const avail = (p: Period): number | null => {
    const direct = sum(p, AVAILABLE_LABELS);
    if (direct != null) return direct;
    let t = 0, any = false;
    for (const ym of p.ym) {
      const one: Period = { key: "", label: "", ym: [ym] };
      const r = sum(one, OCCUPIED_LABELS); let o = sum(one, ["Taxa de Ocupação"]);
      if (r == null || o == null || o === 0) continue;
      if (o > 1) o = o / 100;
      t += r / o; any = true;
    }
    return any ? t : null;
  };
  const groupSum = (p: Period, g: string): number | null => {
    let t = 0, any = false;
    for (const [y, m] of p.ym) {
      const v = groupStore.get(`${y}-${m}`)?.get(g);
      if (v != null) { t += v; any = true; }
    }
    return any ? t : null;
  };
  const div = (a: number | null, b: number | null, s = 1) => (a == null || b == null || b === 0 ? null : (a / b) * s);

  type Row = { label: string; f: Fmt; v: (p: Period) => number | null; cost?: boolean };
  const rn = (p: Period) => sum(p, OCCUPIED_LABELS);
  const rev = (p: Period) => sum(p, REVENUE_LABELS);
  const lodging = (p: Period) => sum(p, LODGING_LABELS);
  const guests = (p: Period) => sum(p, GUESTS_LABELS);
  const abCost = (p: Period) => {
    const total = sum(p, ["Despesas de Alimentos e Bebidas (A&B)"], true);
    if (total != null) return total;
    const a = sum(p, CMV_LABELS, true); const b = sum(p, BREAKFAST_COST_LABELS, true);
    return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  };
  const labor = (p: Period) => sum(p, LABOR_LABELS, true);

  const allGroups = useMemo(() => {
    const s = new Set<string>();
    for (const gr of groupStore.values()) for (const g of gr.keys()) s.add(g);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [groupStore]);

  const blocks: Array<{ title: string; rows: Row[] }> = [
    { title: "Receita e operação", rows: [
      { label: "Roomnights", f: "int", v: rn },
      { label: "Ocupação", f: "pct", v: (p) => div(rn(p), avail(p), 100) },
      { label: "Diária Média", f: "brl2", v: (p) => div(lodging(p), rn(p)) },
      { label: "RevPAR", f: "brl2", v: (p) => div(lodging(p), avail(p)) },
      { label: "Receita Bruta Total", f: "brl", v: rev },
      { label: "Receita de Hospedagem", f: "brl", v: lodging },
      { label: "Receita Total por RN", f: "brl2", v: (p) => div(rev(p), rn(p)) },
      { label: "GOP", f: "brl", v: (p) => sum(p, GOP_LABELS) },
      { label: "Lucro Líquido", f: "brl", v: (p) => sum(p, NET_PROFIT_LABELS) },
    ] },
    { title: "A&B, CMV e hóspedes", rows: [
      { label: "Receita de A&B", f: "brl", v: (p) => sum(p, AB_REVENUE_LABELS) },
      { label: "Custo de A&B (CMV + café)", f: "brl", v: abCost, cost: true },
      { label: "CMV", f: "brl", v: (p) => sum(p, CMV_LABELS, true), cost: true },
      { label: "Hóspedes", f: "int", v: guests },
      { label: "Receita de A&B por hóspede", f: "brl2", v: (p) => div(sum(p, AB_REVENUE_LABELS), guests(p)) },
      { label: "Custo de A&B por hóspede", f: "brl2", v: (p) => div(abCost(p), guests(p)), cost: true },
    ] },
    { title: "Folha", rows: [
      { label: "Folha total", f: "brl", v: labor, cost: true },
      { label: "Salários", f: "brl", v: (p) => sum(p, ["Salários", "Salários e Ordenados"], true), cost: true },
      { label: "Encargos", f: "brl", v: (p) => sum(p, ["Encargos"], true) ?? sumAll(p, ["FGTS", "INSS", "Provisão 13º e Encargos"]), cost: true },
      { label: "Benefícios", f: "brl", v: (p) => sum(p, ["Benefícios"], true) ?? sumAll(p, ["Assistência Médica Social", "Vale Transporte", "Despesas com Alimenteção", "Despesas com Alimentação"]), cost: true },
      { label: "Folha % da receita total", f: "pct", v: (p) => div(labor(p), rev(p), 100), cost: true },
      { label: "Folha por RN", f: "brl2", v: (p) => div(labor(p), rn(p)), cost: true },
    ] },
    { title: "Custos por roomnight", rows: allGroups.map((g) => ({ label: g, f: "brl2" as Fmt, v: (p: Period) => div(groupSum(p, g), rn(p)), cost: true })) },
    { title: "Custos que dependem da tarifa (% da receita de hospedagem)", rows: TARIFF_GROUPS.map((g) => ({ label: g, f: "pct" as Fmt, v: (p: Period) => div(groupSum(p, g), lodging(p), 100), cost: true })) },
  ];

  // Entidades complementares (Pool / Condomínio) — nunca somadas ao hotel.
  const entityTable = useMemo(() => {
    const ents = data?.entities ?? [];
    if (!ents.length) return null;
    const byEnt = new Map<string, Map<number, Map<string, number>>>();
    for (const [ent, y, m, label, , v] of ents) {
      if (!monthly && !monthsSet.has(m)) continue;
      const e = byEnt.get(ent) ?? new Map(); byEnt.set(ent, e);
      const yr = e.get(y) ?? new Map(); e.set(y, yr);
      const cl = cleanLabel(label);
      yr.set(cl, (yr.get(cl) ?? 0) + Number(v));
    }
    return byEnt;
  }, [data, months.join(","), monthly]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {monthly ? "Hotel recente: colunas mês a mês (todos os meses com dado)." : "Colunas ano a ano, somando só os meses marcados acima. Meses sem DRE ficam de fora — nunca contam como zero."}
        </span>
      </div>
      {!monthly && years.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Anos</span>
          {years.map((y) => {
            const on = !hiddenYears.includes(y);
            return (
              <Button key={y} size="sm" variant={on ? "default" : "outline"} className="h-7 px-2.5 text-xs"
                onClick={() => setHiddenYears((p) => on ? (years.length - p.length > 1 ? [...p, y] : p) : p.filter((x) => x !== y))}>
                {y}
              </Button>
            );
          })}
          {hiddenYears.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setHiddenYears([])}>Todos os anos</Button>
          )}
        </div>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando histórico…</Card>
      ) : periods.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Sem DRE para este hotel.</Card>
      ) : (
        blocks.map((b) => (
          <Card key={b.title} className="shadow-soft overflow-x-auto">
            <div className="px-4 pt-3 text-sm font-semibold uppercase tracking-wider">{b.title}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px] sticky left-0 bg-card">Linha</TableHead>
                  {periods.map((p) => (
                    <TableHead key={p.key} className="text-right min-w-[120px]">
                      {p.label}
                      {!monthly && <span className="block text-[10px] font-normal text-muted-foreground">{p.ym.length} {p.ym.length === 1 ? "mês" : "meses"}</span>}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="sticky left-0 bg-card text-sm">{r.label}</TableCell>
                    {periods.map((p, i) => {
                      const v = p.ym.length ? r.v(p) : null;
                      const prev = i > 0 && periods[i - 1].ym.length ? r.v(periods[i - 1]) : null;
                      const delta = v != null && prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
                      const good = delta == null ? null : r.cost ? delta <= 0 : delta >= 0;
                      return (
                        <TableCell key={p.key} className="text-right tabular-nums">
                          <span className={v == null ? "text-xs text-muted-foreground" : ""}>{fmt(v, r.f)}</span>
                          {delta != null && (
                            <span className={`block text-[10px] font-semibold ${good ? "text-success" : "text-destructive"}`}>
                              {delta >= 0 ? "+" : ""}{delta.toFixed(1).replace(".", ",")}%
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))
      )}

      {entityTable && [...entityTable.entries()].map(([ent, byYear]) => {
        const yrs = [...byYear.keys()].sort();
        const get = (y: number, labels: string[]) => {
          const row = byYear.get(y)!;
          for (const l of labels) { const v = row.get(cleanLabel(l)); if (v != null) return v; }
          return null;
        };
        return (
          <Card key={ent} className="shadow-soft overflow-x-auto border-dashed">
            <div className="px-4 pt-3 text-sm font-semibold uppercase tracking-wider">Informação complementar — {ent}</div>
            <p className="px-4 text-xs text-muted-foreground">Mostrado à parte. Não é somado aos indicadores do hotel nem ao total da rede.</p>
            <Table>
              <TableHeader><TableRow><TableHead>Linha</TableHead>{yrs.map((y) => <TableHead key={y} className="text-right">{y}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {([["Receita de Hospedagem", LODGING_LABELS], ["Receita Bruta Total", REVENUE_LABELS], ["Receita Líquida", ["(=) Receita Líquida", "RECEITA LÍQUIDA TOTAL (RECEITA - DEDUÇÕES)"]], ["GOP", GOP_LABELS], ["Resultado Operacional Líquido", ["Resultado Operacional Líquido"]], ["Lucro Líquido", NET_PROFIT_LABELS]] as [string, string[]][]).filter(([, labels]) => yrs.some((y) => get(y, labels) != null)).map(([lbl, labels]) => (
                  <TableRow key={lbl as string}>
                    <TableCell>{lbl as string}</TableCell>
                    {yrs.map((y) => <TableCell key={y} className="text-right tabular-nums">{fmt(get(y, labels as string[]), "brl")}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
