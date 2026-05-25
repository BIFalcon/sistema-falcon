import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, Trophy, Loader2 } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useRhEmployees, useUploadRhFile, calcMetrics } from "@/hooks/useRh";

const SEX_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--muted-foreground))"];
const BAR_COLOR = "hsl(var(--primary))";

function formatPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4 shadow-soft">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

export default function TurnoverPage() {
  const { allowedHotels, isMaster } = useAuth();
  const { hotelId, month, year } = useModuleFilters("rh");
  const [periodMonths, setPeriodMonths] = useState(1);

  const PERIOD_OPTIONS = [
    { value: 1, label: "Mensal" },
    { value: 2, label: "Bimestral" },
    { value: 3, label: "Trimestral" },
    { value: 6, label: "Semestral" },
    { value: 12, label: "Anual" },
  ];
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);

  const { data: allEmployees = [], isLoading } = useRhEmployees();
  const upload = useUploadRhFile();

  const scopedEmployees = useMemo(
    () => (hotelId ? allEmployees.filter((e) => e.hotel_id === hotelId) : allEmployees),
    [allEmployees, hotelId],
  );

  const metrics = useMemo(
    () => calcMetrics(scopedEmployees, month, year),
    [scopedEmployees, month, year],
  );

  const sexData = [
    { name: "Masculino", value: metrics.porSexo.M },
    { name: "Feminino", value: metrics.porSexo.F },
    { name: "Não identificado", value: metrics.porSexo.N },
  ].filter((d) => d.value > 0);

  const ageData = Object.entries(metrics.porFaixaEtaria).map(([faixa, total]) => ({ faixa, total }));

  const ranking = useMemo(() => {
    if (allowedHotels.length <= 1) return [];
    return allowedHotels
      .map((h) => {
        const emps = allEmployees.filter((e) => e.hotel_id === h.id);
        const m = calcMetrics(emps);
        return { hotel: h, pctRotatividade: m.pctRotatividade, total: emps.length };
      })
      .sort((a, b) => b.pctRotatividade - a.pctRotatividade);
  }, [allowedHotels, allEmployees]);

  const handleFile = async (file: File) => {
    if (!hotelId) {
      toast.error("Selecione um hotel antes de enviar a planilha.");
      return;
    }
    try {
      const res = await upload.mutateAsync({ file, hotelId });
      toast.success(
        `Importação concluída — formato ${res.parsed.format}, ${res.parsed.employees.length} colaborador(es).`,
      );
    } catch (e: any) {
      toast.error("Erro ao processar planilha: " + (e?.message ?? "desconhecido"));
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
          <h1 className="text-3xl font-semibold">Turnover &amp; Rotatividade</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Indicadores de pessoal e movimentações por hotel.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          {(allowedHotels.length > 1 || isMaster) && (
            <Button variant="outline" onClick={() => setRankOpen(true)}>
              <Trophy className="h-4 w-4 mr-2" /> Ver ranking
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {PERIOD_OPTIONS.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={periodMonths === p.value ? "default" : "outline"}
            onClick={() => setPeriodMonths(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Ativos" value={String(metrics.ativos)} />
        <KpiCard label="Desligados (12m)" value={String(metrics.inativos)} />
        <KpiCard label="% Experiência" value={formatPct(metrics.pctExperiencia)} sub="< 90 dias" />
        <KpiCard label="% Turnover" value={formatPct(metrics.pctTurnover)} />
        <KpiCard label="% Rotatividade" value={formatPct(metrics.pctRotatividade)} />
        <KpiCard label="Tempo de casa" value={`${metrics.tempoCasaMedio.toFixed(1)} a`} sub="médio (ativos)" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 shadow-soft">
          <p className="text-sm font-semibold mb-3">Distribuição por sexo</p>
          {sexData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
                <Pie
                  data={sexData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={65}
                  label={({ value, percent }) => `${value} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                  labelLine
                >
                  {sexData.map((_, i) => <Cell key={i} fill={SEX_COLORS[i % SEX_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card className="p-4 shadow-soft">
          <p className="text-sm font-semibold mb-3">Distribuição por faixa etária</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ageData}>
              <XAxis dataKey="faixa" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Bar dataKey="total" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Upload */}
      <Card
        className={`p-8 border-2 border-dashed shadow-soft transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Arraste a planilha de RH aqui</p>
            <p className="text-xs text-muted-foreground mt-1">
              Formatos aceitos: POUSADA, ASSENSUS e RCASTRO (.xlsx).
              {!hotelId && <span className="text-amber-600 dark:text-amber-400"> Selecione um hotel acima.</span>}
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Selecionar arquivo
          </Button>
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando colaboradores…</p>}

      {/* Ranking modal */}
      <Dialog open={rankOpen} onOpenChange={setRankOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ranking por % rotatividade</DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-border">
            {ranking.length === 0 && <p className="text-sm text-muted-foreground py-4">Sem dados suficientes.</p>}
            {ranking.map((r, i) => (
              <div key={r.hotel.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="w-7 justify-center">{i + 1}</Badge>
                  <div>
                    <p className="text-sm font-medium">{r.hotel.name}</p>
                    <p className="text-xs text-muted-foreground">{r.total} colaborador(es)</p>
                  </div>
                </div>
                <p className="text-sm font-semibold">{formatPct(r.pctRotatividade)}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}