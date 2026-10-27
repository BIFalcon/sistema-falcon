import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQueries } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, LabelList, LineChart, Line, Legend, CartesianGrid } from "recharts";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBRL } from "@/lib/formatters";
import { logSensitiveExport } from "@/hooks/useRhPayroll";
import {
  buildConsolidatedRows, consolidatedTotal, costPerRnExtremes, defaultEvolutionHotels, departmentNames,
  type RhConsolidatedHotelRaw, type RhConsolidatedRow,
} from "@/lib/rhConsolidated";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--chart-3, 200 60% 45%))", "hsl(var(--chart-4, 30 80% 50%))", "hsl(var(--chart-5, 280 50% 55%))", "hsl(var(--muted-foreground))"];
const money = (v: number | null | undefined) => (v == null ? "Sem dado" : fmtBRL(v));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);
const int = (v: number | null | undefined) => (v == null ? "Sem dado" : v.toLocaleString("pt-BR"));

type SortKey = "hotel_name" | "total_cost" | "headcount" | "cost_per_employee" | "roomnights" | "cost_per_roomnight" | "overtime_earnings" | `dept:${string}`;

function useConsolidatedYear(year: number, enabled: boolean) {
  return useQueries({
    queries: Array.from({ length: 12 }, (_, i) => ({
      enabled,
      queryKey: ["rh-payroll", "consolidated", year, i + 1],
      staleTime: 10 * 60 * 1000,
      queryFn: async () => {
        const { data, error } = await supabase.rpc("get_rh_payroll_consolidated" as never, { _month: i + 1, _year: year } as never);
        if (error) throw error;
        return buildConsolidatedRows((data ?? []) as unknown as RhConsolidatedHotelRaw[]);
      },
    })),
  });
}

export function RhConsolidatedTab({ month, year }: { month: number; year: number }) {
  const months = useConsolidatedYear(year, true);
  const current = months[month - 1];
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "total_cost", dir: "desc" });
  const [evoHotels, setEvoHotels] = useState<string[] | null>(null);
  const [exporting, setExporting] = useState(false);

  const allRows = current.data ?? [];
  const brands = useMemo(() => [...new Set(allRows.map((r) => r.brand).filter(Boolean) as string[])].sort(), [allRows]);
  const rows = useMemo(() => allRows.filter((r) => brand === "all" || r.brand === brand), [allRows, brand]);
  const depts = useMemo(() => departmentNames(rows), [rows]);
  const total = useMemo(() => consolidatedTotal(rows), [rows]);
  const extremes = useMemo(() => costPerRnExtremes(rows), [rows]);

  useEffect(() => { setEvoHotels(null); }, [brand, month, year]);
  const selectedEvo = evoHotels ?? defaultEvolutionHotels(rows);

  const value = (r: RhConsolidatedRow, k: SortKey): number | string | null =>
    k.startsWith("dept:") ? r.dept[k.slice(5)]?.value ?? null : (r[k as keyof RhConsolidatedRow] as number | string | null);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const va = value(a, sort.key), vb = value(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : (va as number) - (vb as number);
    return sort.dir === "asc" ? c : -c;
  }), [rows, sort]);

  const rnChart = useMemo(() => rows.filter((r) => r.cost_per_roomnight != null)
    .sort((a, b) => b.cost_per_roomnight! - a.cost_per_roomnight!)
    .map((r) => ({ name: r.hotel_name, value: Math.round(r.cost_per_roomnight! * 100) / 100 })), [rows]);
  const rnAvg = rnChart.length ? rnChart.reduce((a, r) => a + r.value, 0) / rnChart.length : null;

  const evoData = MONTHS.map((m, i) => {
    const point: Record<string, string | number | null> = { mes: m };
    const list = months[i].data ?? [];
    for (const id of selectedEvo) {
      const r = list.find((x) => x.hotel_id === id);
      point[`c_${id}`] = r?.total_cost ?? null;
      point[`r_${id}`] = r?.cost_per_roomnight ?? null;
    }
    return point;
  });
  const nameOf = (id: string) => allRows.find((r) => r.hotel_id === id)?.hotel_name ?? id;

  const toggleEvo = (id: string) => {
    const cur = selectedEvo;
    if (cur.includes(id)) setEvoHotels(cur.filter((x) => x !== id));
    else if (cur.length < 6) setEvoHotels([...cur, id]);
    else toast.info("Selecione no máximo 6 hotéis.");
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      await logSensitiveExport({ module: "rh_custo_folha_consolidado", format: "xlsx", month, year, details: { hotels: rows.length, brand, aggregated_only: true } });
      const line = (name: string, r: Omit<RhConsolidatedRow, keyof RhConsolidatedHotelRaw> & Pick<RhConsolidatedRow, "total_cost" | "headcount" | "roomnights" | "overtime_earnings">) => {
        const o: Record<string, string | number | null> = {
          Hotel: name, "Custo total": r.total_cost, Headcount: r.headcount, "Custo/colaborador": r.cost_per_employee,
          Roomnights: r.roomnights, "Custo/roomnight": r.cost_per_roomnight, "Horas extras": r.overtime_earnings, "Horas extras %": r.overtime_pct,
        };
        for (const d of depts) { o[d] = r.dept[d]?.value ?? null; o[`${d} %`] = r.dept[d]?.pct ?? null; }
        for (const k of Object.keys(o)) if (o[k] == null) o[k] = "Sem dado";
        return o;
      };
      const data = [...sorted.map((r) => line(r.hotel_name, r)), line("Total", total)];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Consolidado");
      XLSX.writeFile(wb, `custo-folha-consolidado-${year}-${String(month).padStart(2, "0")}.xlsx`);
    } catch (e: unknown) {
      toast.error("Não foi possível exportar: " + (e instanceof Error ? e.message : "erro"));
    } finally { setExporting(false); }
  };

  const Th = ({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) => {
    const active = sort.key === k;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className={`py-2 px-2 ${right ? "text-right" : "text-left"}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${active ? "text-foreground" : "text-muted-foreground"}`}
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}>
          {label}<Icon className="h-3 w-3" />
        </button>
      </th>
    );
  };

  if (current.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (current.error) return <Card className="p-6 text-sm text-destructive">Não foi possível carregar o consolidado: {(current.error as Error).message}</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {brands.length > 1 && (
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Bandeira" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as bandeiras</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline">{rows.length} hotéis com folha em {MONTHS[month - 1]}/{year}</Badge>
        </div>
        {rows.length > 0 && (
          <Button variant="outline" onClick={exportExcel} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}Exportar Excel
          </Button>
        )}
      </div>

      {rows.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">Nenhuma folha importada neste mês para os hotéis disponíveis.</Card> : <>
        <Card className="p-4 shadow-soft">
          <p className="text-sm font-semibold mb-1">Comparativo entre hotéis</p>
          <p className="text-xs text-muted-foreground mb-3">Valores agregados por hotel. Destaque: maior e menor custo por roomnight.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr>
                <Th k="hotel_name" label="Hotel" right={false} />
                <Th k="total_cost" label="Custo total" />
                <Th k="headcount" label="Headcount" />
                <Th k="cost_per_employee" label="Custo/colab." />
                <Th k="roomnights" label="Roomnights" />
                <Th k="cost_per_roomnight" label="Custo/RN" />
                <Th k="overtime_earnings" label="Horas extras" />
                {depts.map((d) => <Th key={d} k={`dept:${d}`} label={d} />)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {sorted.map((r) => {
                  const mark = r.hotel_id === extremes.max ? "Maior" : r.hotel_id === extremes.min ? "Menor" : null;
                  return (
                    <tr key={r.hotel_id}>
                      <td className="py-2 px-2">{r.hotel_name}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.total_cost)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{int(r.headcount)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.cost_per_employee)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{int(r.roomnights)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums ${mark ? "font-semibold" : ""}`}>
                        {money(r.cost_per_roomnight)}{mark && <Badge variant="secondary" className="ml-1 text-[10px]">{mark}</Badge>}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.overtime_earnings)} <span className="text-xs text-muted-foreground">{pct(r.overtime_pct)}</span></td>
                      {depts.map((d) => <td key={d} className="py-2 px-2 text-right tabular-nums">{money(r.dept[d]?.value)} <span className="text-xs text-muted-foreground">{pct(r.dept[d]?.pct)}</span></td>)}
                    </tr>
                  );
                })}
                <tr className="font-semibold bg-muted/40">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2 text-right tabular-nums">{money(total.total_cost)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{int(total.headcount)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{money(total.cost_per_employee)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{int(total.roomnights)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{money(total.cost_per_roomnight)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{money(total.overtime_earnings)} <span className="text-xs text-muted-foreground">{pct(total.overtime_pct)}</span></td>
                  {depts.map((d) => <td key={d} className="py-2 px-2 text-right tabular-nums">{money(total.dept[d]?.value)} <span className="text-xs text-muted-foreground">{pct(total.dept[d]?.pct)}</span></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4 shadow-soft">
          <p className="text-sm font-semibold mb-3">Custo de folha por roomnight — {MONTHS[month - 1]}/{year}</p>
          {rnChart.length === 0 ? <p className="text-sm text-muted-foreground">Sem dado de Roomnights na DRE para este mês.</p> :
            <ResponsiveContainer width="100%" height={Math.max(160, rnChart.length * 34 + 40)}>
              <BarChart data={rnChart} layout="vertical" margin={{ left: 10, right: 70 }}>
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmtBRL(v)} />
                <YAxis type="category" dataKey="name" width={180} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} />
                {rnAvg != null && <ReferenceLine x={rnAvg} stroke="hsl(var(--accent))" strokeDasharray="4 4" label={{ value: `Média ${fmtBRL(rnAvg)}`, position: "top", fontSize: 11, fill: "hsl(var(--foreground))" }} />}
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="value" position="right" formatter={(v: number) => fmtBRL(v)} fontSize={11} fill="hsl(var(--foreground))" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>}
        </Card>

        <Card className="p-4 shadow-soft space-y-3">
          <div>
            <p className="text-sm font-semibold">Evolução mensal {year}</p>
            <p className="text-xs text-muted-foreground">Até 6 hotéis. Padrão: os 3 de maior custo no mês do filtro.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...rows].sort((a, b) => a.hotel_name.localeCompare(b.hotel_name, "pt-BR")).map((r) => (
              <Button key={r.hotel_id} size="sm" variant={selectedEvo.includes(r.hotel_id) ? "default" : "outline"} className="h-7 text-xs" onClick={() => toggleEvo(r.hotel_id)}>
                {r.hotel_name}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {([["c_", "Custo total", (v: number) => `${Math.round(v / 1000)}k`], ["r_", "Custo por roomnight", (v: number) => fmtBRL(v)]] as const).map(([prefix, title, tick]) => (
              <div key={prefix}>
                <p className="text-xs font-semibold mb-2">{title}</p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={evoData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={tick} width={70} />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {selectedEvo.map((id, i) => <Line key={id} type="monotone" dataKey={`${prefix}${id}`} name={nameOf(id)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} connectNulls={false} dot={{ r: 3 }} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </Card>
      </>}
    </div>
  );
}
