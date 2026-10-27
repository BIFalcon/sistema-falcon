import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Loader2, Download, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { canUploadRh } from "@/lib/rhAccess";
import { canViewRhConsolidated } from "@/lib/rhConsolidated";
import { RhConsolidatedTab } from "@/components/rh/RhConsolidatedTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sortPayrollEntries, type PayrollSort, type PayrollSortKey } from "@/lib/payrollSort";
import { payrollCostPerRoomnight, payrollDepartmentPercentage, payrollMonthlySeries } from "@/lib/payrollMetrics";
import type { RhMonthlyResult } from "@/lib/rhMonthlyParser";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { fmtBRL, fmtDate } from "@/lib/formatters";
import {
  usePayrollSummary, usePayrollHistory, usePayrollEntries, usePayrollRoomnights,
  useUploadPayroll, logSensitiveExport, previewMonthlyPayroll,
} from "@/hooks/useRhPayroll";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EMPLOYEE_COLUMNS: { key: PayrollSortKey; label: string; numeric?: boolean }[] = [
  { key: "employee_name", label: "Funcionário" },
  { key: "position", label: "Função" },
  { key: "department", label: "Departamento" },
  { key: "admission_date", label: "Admissão" },
  { key: "base_salary", label: "Sal. Base", numeric: true },
  { key: "overtime_hours_earnings", label: "Hora extra", numeric: true },
  { key: "night_earnings", label: "Adicional noturno", numeric: true },
  { key: "reflex_earnings", label: "DSR / reflexos", numeric: true },
  { key: "holiday_earnings", label: "Feriado trabalhado", numeric: true },
  { key: "overtime_earnings", label: "Total HE/noturno/reflexos", numeric: true },
  { key: "total_cost", label: "Líquido", numeric: true },
];
const payrollMoney = (value: number | null | undefined) => value == null ? "Sem dado" : fmtBRL(value);

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="p-4 shadow-soft">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground break-words">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && (
        <p className={`text-xs mt-0.5 flex items-center gap-1 ${warn ? "text-destructive" : "text-muted-foreground"}`}>
          {warn && <AlertTriangle className="h-3 w-3" />}{sub}
        </p>
      )}
    </Card>
  );
}

export default function CustoFolhaPage() {
  const { roles, allowedHotels } = useAuth();
  const { month, year } = useModuleFilters("rh");
  if (!canViewRhConsolidated(roles, allowedHotels.length)) return <CustoFolhaPorHotel />;
  return (
    <Tabs defaultValue="hotel" className="space-y-4">
      <TabsList>
        <TabsTrigger value="hotel">Por hotel</TabsTrigger>
        <TabsTrigger value="consolidado">Consolidado</TabsTrigger>
      </TabsList>
      <TabsContent value="hotel"><CustoFolhaPorHotel /></TabsContent>
      <TabsContent value="consolidado">
        <div className="space-y-4" translate="no">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
            <h1 className="text-3xl font-semibold">Custo e Folha — Consolidado</h1>
            <p className="text-sm text-muted-foreground mt-1">{MONTHS[month - 1]}/{year}</p>
          </div>
          <RhConsolidatedTab month={month} year={year} />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function CustoFolhaPorHotel() {
  const { roles, allowedHotels } = useAuth();
  const isRhManager = canUploadRh(roles);
  const { hotelId, month, year, setMonth, setYear } = useModuleFilters("rh");
  const [pending, setPending] = useState<{ file: File; parsed: RhMonthlyResult } | null>(null);
  const [reading, setReading] = useState(false);
  const [warnings, setWarnings] = useState<RhMonthlyResult["unknownHotels"]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [employeeSort, setEmployeeSort] = useState<PayrollSort | null>(null);

  const { data: s, isLoading } = usePayrollSummary(hotelId, month, year);
  const { data: history = [] } = usePayrollHistory(hotelId, year);
  const { data: entries = [] } = usePayrollEntries(isRhManager, hotelId, month, year);
  const sortedEntries = useMemo(() => sortPayrollEntries(entries, employeeSort), [entries, employeeSort]);
  const toggleEmployeeSort = (key: PayrollSortKey) => {
    setEmployeeSort(current => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  };
  const { data: roomnights } = usePayrollRoomnights(hotelId, month, year);
  const upload = useUploadPayroll();
  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? hotelId ?? "";

  const handleFile = async (file: File) => {
    setReading(true);
    try {
      const parsed = await previewMonthlyPayroll(file);
      setWarnings(parsed.unknownHotels);
      if (!parsed.rows.length) throw new Error("Nenhum hotel reconhecido; nada foi substituído.");
      setPending({ file, parsed });
    } catch (e: unknown) {
      toast.error("Erro ao ler folha: " + (e instanceof Error ? e.message : "erro desconhecido"));
    } finally { setReading(false); }
  };

  const confirmUpload = async () => {
    if (!pending) return;
    try {
      const result = await upload.mutateAsync(pending);
      setMonth(result.month); setYear(result.year); setPending(null);
      toast.success(`Folha ${String(result.month).padStart(2, "0")}/${result.year} importada: ${new Set(result.rows.map((row) => row.hotel_id)).size} hotéis, ${result.rows.length} colaboradores.`);
      if (result.unknownHotels.length) toast.warning("Hotéis não importados: " + result.unknownHotels.map((hotel) => `${hotel.name}: ${hotel.count} linhas`).join("; "), { duration: 15000 });
    } catch (e: unknown) {
      toast.error("Erro ao importar folha: " + (e instanceof Error ? e.message : "erro desconhecido"));
    }
  };

  const exportExcel = async () => {
    if (!s || !hotelId) return;
    setExporting(true);
    try {
      await logSensitiveExport({
        module: "rh_custo_folha", format: "xlsx", hotelId, month, year,
        details: { individual: isRhManager, rows: isRhManager ? entries.length : s.departments.length },
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.departments.map((d) => ({
        Departamento: d.department, Colaboradores: d.headcount, "Líquido": d.total_cost ?? "Sem dado",
        "Hora extra": d.overtime_hours_earnings ?? "Sem dado", "Adicional noturno": d.night_earnings ?? "Sem dado", "DSR / reflexos": d.reflex_earnings ?? "Sem dado", "Feriado trabalhado": d.holiday_earnings ?? "Sem dado", "Total HE/noturno/reflexos": d.overtime_earnings ?? "Sem dado",
      }))), "Por departamento");
      if (isRhManager) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.map((e) => ({
          Funcionário: e.employee_name, Função: e.position, Departamento: e.department, Vínculo: e.bond,
          Admissão: e.admission_date, "Sal. Base": e.base_salary, FGTS: e.fgts, "INSS Patronal": e.inss_patronal, Líquido: e.total_cost ?? "Sem dado",
          "Hora extra": e.overtime_hours_earnings ?? "Sem dado", "Adicional noturno": e.night_earnings ?? "Sem dado", "DSR / reflexos": e.reflex_earnings ?? "Sem dado", "Feriado trabalhado": e.holiday_earnings ?? "Sem dado", "Total HE/noturno/reflexos": e.overtime_earnings ?? "Sem dado",
        }))), "Colaboradores");
      }
      XLSX.writeFile(wb, `custo-folha-${hotelId}-${year}-${String(month).padStart(2, "0")}.xlsx`);
    } catch (e: any) {
      toast.error("Não foi possível exportar: " + (e?.message ?? "erro"));
    } finally {
      setExporting(false);
    }
  };

  const hasData = !!s && s.headcount > 0;
  const costPerRn = payrollCostPerRoomnight(s?.total_cost, roomnights);
  const histData = payrollMonthlySeries(history, []).map(point => ({ ...point, mes: MONTHS[point.reference_month - 1] }));

  return (
    <div className="space-y-6" translate="no">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
          <h1 className="text-3xl font-semibold">Custo e Folha</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hotelName ? `${hotelName} — ` : ""}{MONTHS[month - 1]}/{year}
          </p>
        </div>
        {hasData && (
          <Button variant="outline" onClick={exportExcel} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Exportar Excel
          </Button>
        )}
      </div>

      {!hotelId && <p className="text-sm text-muted-foreground">Selecione um hotel no topo.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {hotelId && !isLoading && !hasData && (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma folha importada para este hotel e mês.</Card>
      )}

      {hasData && s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Salário Base total" value={payrollMoney(s.total_salary)} />
            <Kpi label="Proventos (Bruto) total" value={payrollMoney(s.total_gross_earnings)} />
            <Kpi label="Líquido total" value={payrollMoney(s.total_cost)} />
            <Kpi label="Hora extra/noturno/reflexos total" value={payrollMoney(s.total_overtime_earnings)} />
            <Kpi label="Colaboradores" value={String(s.headcount)} />
            <Kpi
              label="Roomnights"
              value={roomnights != null ? roomnights.toLocaleString("pt-BR") : "—"}
              sub={costPerRn != null ? `${fmtBRL(costPerRn)} de folha por RN` : roomnights != null ? "Sem custo por RN" : "Sem dado de Roomnights na DRE"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 shadow-soft">
              <p className="text-sm font-semibold mb-3">Por departamento</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Departamento</th><th className="py-2 text-right">Colab.</th>
                    <th className="py-2 text-right">Líquido</th><th className="py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.departments.map((d) => (
                    <tr key={d.department}>
                      <td className="py-2">{d.department}</td>
                      <td className="py-2 text-right">{d.headcount}</td>
                      <td className="py-2 text-right">{payrollMoney(d.total_cost)}</td>
                      <td className="py-2 text-right">{payrollDepartmentPercentage(d.total_cost, s.total_cost)?.toFixed(1).replace(".", ",").concat("%") ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-sm font-semibold mb-3">Evolução mensal — Líquido {year}</p>
              {!histData.some(point => point.total != null) ? <p className="text-sm text-muted-foreground">Sem dado</p> : <ResponsiveContainer width="100%" height={260}>
                <BarChart data={histData}>
                  <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>}
            </Card>
          </div>

          <Card className="p-4 shadow-soft">
            <p className="text-sm font-semibold mb-3">Hora extra, noturno e reflexos — Por departamento</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Departamento</th>
                  <th className="py-2 px-2 text-right">Hora extra</th>
                  <th className="py-2 px-2 text-right">Adicional noturno</th>
                  <th className="py-2 px-2 text-right">DSR / reflexos</th>
                  <th className="py-2 px-2 text-right">Feriado trabalhado</th>
                  <th className="py-2 pl-2 text-right">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-border">{s.departments.map(d => (
                  <tr key={d.department}>
                    <td className="py-2 pr-3">{d.department}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{payrollMoney(d.overtime_hours_earnings)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{payrollMoney(d.night_earnings)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{payrollMoney(d.reflex_earnings)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{payrollMoney(d.holiday_earnings)}</td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap font-semibold">{payrollMoney(d.overtime_earnings)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>

          {isRhManager && (
            <Card className="p-4 shadow-soft">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-semibold">Colaboradores</p>
                <Badge variant="outline">visível só para RH e Master</Badge>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full table-fixed text-[11px] xl:text-xs [&_td]:px-1 [&_td]:py-2 [&_td]:align-top [&_td]:whitespace-normal [&_td]:break-words [&_th]:px-1">
                  <colgroup>
                    <col className="w-[13%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    {EMPLOYEE_COLUMNS.filter(column => column.numeric).map(column => <col key={column.key} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {EMPLOYEE_COLUMNS.map(column => {
                        const active = employeeSort?.key === column.key;
                        const Icon = active ? (employeeSort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                        return (
                          <th key={column.key} scope="col" aria-sort={active ? (employeeSort.direction === "asc" ? "ascending" : "descending") : "none"}
                            className={`py-2 align-bottom ${column.numeric ? "text-right" : ""}`}>
                            <Button variant="ghost" onClick={() => toggleEmployeeSort(column.key)}
                              className={`h-auto min-h-14 w-full flex-col gap-1 whitespace-normal px-0 py-1 text-[10px] leading-tight font-semibold uppercase tracking-normal ${column.numeric ? "items-end text-right" : "items-start text-left"} ${active ? "text-foreground" : "text-muted-foreground"}`}>
                              <span className="min-w-0 break-words">{column.key === "overtime_earnings" ? <>Total HE /<br />noturno /<br />reflexos</> : column.label}</span>
                              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </Button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedEntries.map((e) => (
                      <tr key={e.id}>
                        <td>{e.employee_name}</td>
                        <td>{e.position ?? "—"}</td>
                        <td>{e.department ?? "—"}</td>
                        <td>{fmtDate(e.admission_date)}</td>
                        {[e.base_salary, e.overtime_hours_earnings, e.night_earnings, e.reflex_earnings, e.holiday_earnings, e.overtime_earnings, e.total_cost].map((value, index) => (
                          <td key={index} className="text-right tabular-nums">{value == null ? "Sem dado" : <>R$ <span className="whitespace-nowrap">{value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {warnings.length > 0 && <div className="text-sm text-destructive" role="alert">
        <p className="font-semibold">Hotéis não reconhecidos</p>
        {warnings.map((hotel) => <p key={hotel.name}>{hotel.name}: {hotel.count} linhas não importadas.</p>)}
      </div>}
      <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open && !upload.isPending) setPending(null); }}>
        <AlertDialogContent><AlertDialogHeader>
          <AlertDialogTitle>Importar folha mensal?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending && `${String(pending.parsed.month).padStart(2, "0")}/${pending.parsed.year} — ${pending.parsed.rows.length} colaboradores, ${new Set(pending.parsed.rows.map((row) => row.hotel_id)).size} hotéis. Todos os dados desta competência serão substituídos, inclusive hotéis ausentes do arquivo. Outros meses serão preservados.`}
            {pending?.parsed.unknownHotels.length ? " Há hotéis não reconhecidos; suas linhas não serão importadas. Confira os nomes abaixo antes de continuar." : ""}
          </AlertDialogDescription>
          {pending?.parsed.unknownHotels.map((hotel) => <p className="text-sm text-destructive" key={hotel.name}>{hotel.name}: {hotel.count} linhas</p>)}
        </AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel disabled={upload.isPending}>Cancelar</AlertDialogCancel>
          <Button onClick={confirmUpload} disabled={upload.isPending}>{upload.isPending ? "Importando…" : "Confirmar importação"}</Button>
        </AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      {isRhManager && (
        <Card className="p-8 border-2 border-dashed shadow-soft">
          <div className="flex flex-col items-center text-center gap-3">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Planilha mensal de RH</p>
              <p className="text-xs text-muted-foreground mt-1">
                Quadro de pessoal — todos os hotéis.
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending || reading}>
              {upload.isPending || reading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Selecionar arquivo
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
