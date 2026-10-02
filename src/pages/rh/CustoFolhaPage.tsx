import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Loader2, Download, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { fmtBRL, fmtDate } from "@/lib/formatters";
import {
  usePayrollSummary, usePayrollHistory, usePayrollEntries, usePayrollRoomnights,
  useUploadPayroll, logSensitiveExport,
} from "@/hooks/useRhPayroll";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="p-4 shadow-soft">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
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
  const { isMaster, hasRole, allowedHotels } = useAuth();
  const isRhManager = isMaster || hasRole("rh");
  const { hotelId, month, year } = useModuleFilters("rh");
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  const { data: s, isLoading } = usePayrollSummary(hotelId, month, year);
  const { data: history = [] } = usePayrollHistory(hotelId, year);
  const { data: entries = [] } = usePayrollEntries(isRhManager, hotelId, month, year);
  const { data: roomnights } = usePayrollRoomnights(hotelId, month, year);
  const upload = useUploadPayroll();
  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? hotelId ?? "";

  const handleFile = async (file: File) => {
    try {
      const r = await upload.mutateAsync({ file, month, year });
      toast.success(
        `Folha ${String(month).padStart(2, "0")}/${year} importada: ${r.sheets.length} hotel(is), ${r.sheets.reduce((a, x) => a + x.rows.length, 0)} colaborador(es).` +
          (r.ignoredSheets.length ? ` Abas ignoradas: ${r.ignoredSheets.join(", ")}.` : ""),
      );
    } catch (e: any) {
      toast.error("Erro ao importar folha: " + (e?.message ?? "desconhecido"));
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
        Departamento: d.department, Colaboradores: d.headcount, "Custo total": d.total_cost,
      }))), "Por departamento");
      if (isRhManager) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.map((e) => ({
          Funcionário: e.employee_name, Função: e.position, Departamento: e.department, Vínculo: e.bond,
          Admissão: e.admission_date, "Sal. Base": e.base_salary, FGTS: e.fgts, "INSS Patronal": e.inss_patronal, Total: e.total_cost,
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
  const costPerRn = hasData && roomnights ? s!.total_cost / roomnights : null;
  const histData = MONTHS.map((m, i) => {
    const h = history.find((x) => x.reference_month === i + 1);
    return { mes: m, total: h ? Number(h.total_cost) : 0 };
  });

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
            <Kpi label="Total pago em folha" value={fmtBRL(s.total_cost)} />
            <Kpi label="Colaboradores" value={String(s.headcount)} />
            <Kpi label="Admitidos no mês" value={String(s.admitted)} />
            <Kpi label="Período de experiência" value={String(s.experience)} sub="< 90 dias" />
            <Kpi
              label="Desligados no mês"
              value={s.has_termination_data ? String(s.terminated) : "—"}
              sub={s.has_termination_data ? undefined : "Aguardando dado na planilha"}
              warn={!s.has_termination_data}
            />
            <Kpi
              label="Roomnights"
              value={roomnights != null ? roomnights.toLocaleString("pt-BR") : "—"}
              sub={costPerRn != null ? `${fmtBRL(costPerRn)} de folha por RN` : "sem DRE do mês"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 shadow-soft">
              <p className="text-sm font-semibold mb-3">Por departamento</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Departamento</th><th className="py-2 text-right">Colab.</th>
                    <th className="py-2 text-right">Custo</th><th className="py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.departments.map((d) => (
                    <tr key={d.department}>
                      <td className="py-2">{d.department}</td>
                      <td className="py-2 text-right">{d.headcount}</td>
                      <td className="py-2 text-right">{fmtBRL(d.total_cost)}</td>
                      <td className="py-2 text-right">{((d.total_cost / (s.total_cost || 1)) * 100).toFixed(1).replace(".", ",")}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-sm font-semibold mb-3">Evolução mensal {year}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={histData}>
                  <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {isRhManager && (
            <Card className="p-4 shadow-soft">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-semibold">Colaboradores</p>
                <Badge variant="outline">visível só para RH e Master</Badge>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-3">Funcionário</th><th className="py-2 pr-3">Função</th>
                      <th className="py-2 pr-3">Departamento</th><th className="py-2 pr-3">Admissão</th>
                      <th className="py-2 pr-3 text-right">Sal. Base</th><th className="py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 pr-3">{e.employee_name}</td>
                        <td className="py-2 pr-3">{e.position ?? "—"}</td>
                        <td className="py-2 pr-3">{e.department ?? "—"}</td>
                        <td className="py-2 pr-3">{fmtDate(e.admission_date)}</td>
                        <td className="py-2 pr-3 text-right">{fmtBRL(e.base_salary)}</td>
                        <td className="py-2 text-right">{fmtBRL(e.total_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {isRhManager && (
        <Card className="p-8 border-2 border-dashed shadow-soft">
          <div className="flex flex-col items-center text-center gap-3">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Planilha de custo e folha — {MONTHS[month - 1]}/{year}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Uma aba por hotel (nome da aba = nome do hotel). Abas que não são hotel são ignoradas.
                Reenviar o mesmo mês substitui só aquele mês.
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Selecionar arquivo
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
