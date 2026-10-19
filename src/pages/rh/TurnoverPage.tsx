import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useRhEmployees, calcMetrics, type RhEmployee } from "@/hooks/useRh";
import { fmtDate } from "@/lib/formatters";

const SEX_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--muted-foreground))"];
const BAR_COLOR = "hsl(var(--primary))";

function formatPct(n: number) {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function KpiCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`p-4 shadow-soft ${onClick ? "cursor-pointer transition-colors hover:border-accent hover:bg-accent/5" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

export default function TurnoverPage() {
  const { allowedHotels, isMaster, hasRole } = useAuth();
  const isRhManager = isMaster || hasRole("rh") || hasRole("processos");
  const { hotelId, month, year } = useModuleFilters("rh");
  const [periodMonths, setPeriodMonths] = useState(1);

  const PERIOD_OPTIONS = [
    { value: 1, label: "Mensal" },
    { value: 2, label: "Bimestral" },
    { value: 3, label: "Trimestral" },
    { value: 6, label: "Semestral" },
    { value: 12, label: "Anual" },
  ];
  const [rankOpen, setRankOpen] = useState(false);
  const [detail, setDetail] = useState<{ title: string; rows: RhEmployee[] } | null>(null);

  const rhHotelId = isRhManager ? undefined : hotelId;
  const { data: allEmployees = [], isLoading } = useRhEmployees(rhHotelId, month, year, periodMonths);

  const hotelNames = useMemo(
    () => Object.fromEntries(allowedHotels.map((h) => [h.id, h.name])),
    [allowedHotels],
  );

  const scopedEmployees = useMemo(
    () => (hotelId ? allEmployees.filter((e) => e.hotel_id === hotelId) : allEmployees),
    [allEmployees, hotelId],
  );

  const metrics = useMemo(
    () => calcMetrics(scopedEmployees, month, year, periodMonths),
    [scopedEmployees, month, year, periodMonths],
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
        const m = calcMetrics(emps, month, year, periodMonths);
        return { hotel: h, pctRotatividade: m.pctRotatividade, total: m.total };
      })
      .sort((a, b) => b.pctRotatividade - a.pctRotatividade);
  }, [allowedHotels, allEmployees, month, year, periodMonths]);

  return (
    <div className="space-y-6" translate="no">
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
        <KpiCard
          label="Ativos / Total"
          value={String(metrics.ativos)}
          onClick={() => setDetail({ title: "Ativos", rows: metrics.listaAtivos })}
        />
        <KpiCard
          label="Desligamentos"
          value={String(metrics.inativos)}
          sub="movimentos de desligamento"
          onClick={() => setDetail({ title: "Desligamentos", rows: metrics.listaDesligamentos })}
        />
        <KpiCard
          label="Admitidos"
          value={String(metrics.admitidos)}
          sub="no período"
          onClick={() => setDetail({ title: "Admitidos", rows: metrics.listaAdmitidos })}
        />
        <KpiCard
          label="Período de Experiência"
          value={String(metrics.experiencia)}
          sub="< 90 dias"
          onClick={() => setDetail({ title: "Período de Experiência", rows: metrics.listaExperiencia })}
        />
        <KpiCard label="% Turnover" value={formatPct(metrics.pctTurnover)} />
        <KpiCard label="Tempo de casa" value={`${metrics.tempoCasaMedio.toFixed(1)} a`} sub="médio (ativos)" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 shadow-soft">
          <p className="text-sm font-semibold mb-3">Distribuição por sexo</p>
          {sexData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
          ) : (
            <ResponsiveContainer key={`sex-${hotelId}-${month}-${year}-${periodMonths}`} width="100%" height={240}>
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
          <ResponsiveContainer key={`age-${hotelId}-${month}-${year}-${periodMonths}`} width="100%" height={240}>
            <BarChart data={ageData}>
              <XAxis dataKey="faixa" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Bar dataKey="total" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

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

      {/* Lista detalhada por card */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.title} — {detail?.rows.length ?? 0} colaborador(es)
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            {(detail?.rows.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sem colaboradores neste grupo.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3">Admissão</th>
                    <th className="py-2 pr-3">Rescisão</th>
                    <th className="py-2 pr-3">Hotel</th>
                    <th className="py-2">Setor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail?.rows.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 pr-3">{e.name}</td>
                      <td className="py-2 pr-3">{fmtDate(e.admission_date)}</td>
                      <td className="py-2 pr-3">{fmtDate(e.termination_date)}</td>
                      <td className="py-2 pr-3">{hotelNames[e.hotel_id] ?? e.hotel_id}</td>
                      <td className="py-2">{e.department ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
