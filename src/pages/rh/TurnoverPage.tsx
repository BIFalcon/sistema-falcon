import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useRhEmployees, useRhTurnoverHistory, useRhDepartureReasons, calcMetrics, type RhEmployee } from "@/hooks/useRh";
import { fmtDate } from "@/lib/formatters";

import { departuresBySector, turnoverMonthlySeries } from "@/lib/rhTurnoverAnalytics";

const SECONDARY_COLOR = "hsl(var(--accent))";
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


function ChartMessage({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-12 text-center">{text}</p>;
}

function HotelAxisTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const words = String(payload?.value ?? "").split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 23) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return <text x={x - 6} y={y} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize={10}>
    {lines.map((line, index) => <tspan key={index} x={x - 6} dy={index === 0 ? -(lines.length - 1) * 6 + 3 : 12}>{line}</tspan>)}
  </text>;
}

function CountChart({ title, data, loading, error }: { title: string; data: { name: string; total: number }[]; loading: boolean; error: boolean }) {
  return <section className="space-y-3 min-w-0">
    <h2 className="text-sm font-semibold">{title}</h2>
    {loading ? <ChartMessage text="Carregando desligamentos…" /> : error ? <ChartMessage text="Não foi possível carregar os desligamentos." /> : !data.length ? <ChartMessage text="Sem desligamentos no período" /> : (
      <div className="space-y-3">
        {data.map((row) => <div key={row.name}>
          <div className="flex justify-between gap-3 text-xs mb-1"><span className="break-words min-w-0">{row.name}</span><span className="font-semibold tabular-nums">{row.total}</span></div>
          <ResponsiveContainer width="100%" height={18}>
            <BarChart layout="vertical" data={[row]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis type="number" hide domain={[0, Math.max(...data.map((item) => item.total))]} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip /><Bar name="Desligamentos" dataKey="total" fill={BAR_COLOR} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>)}
      </div>
    )}
  </section>;
}

export default function TurnoverPage() {
  const { allowedHotels, isMaster, matrizHotel, canSeeMatriz } = useAuth();
  const rhHotels = useMemo(() => canSeeMatriz && matrizHotel ? [...allowedHotels, matrizHotel] : allowedHotels, [allowedHotels, matrizHotel, canSeeMatriz]);
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

  const { data: allEmployees = [], isLoading, isError } = useRhEmployees(undefined, month, year, periodMonths);
  const { data: history = [], isLoading: historyLoading, isError: historyError } = useRhTurnoverHistory(month, year);
  const { data: reasonData = [], isLoading: reasonsLoading, isError: reasonsError } = useRhDepartureReasons(hotelId, month, year, periodMonths);

  const hotelNames = useMemo(
    () => Object.fromEntries(rhHotels.map((h) => [h.id, h.name])),
    [rhHotels],
  );

  const scopedEmployees = useMemo(
    () => (hotelId ? allEmployees.filter((e) => e.hotel_id === hotelId) : allEmployees),
    [allEmployees, hotelId],
  );

  const metrics = useMemo(
    () => calcMetrics(scopedEmployees, month, year, periodMonths),
    [scopedEmployees, month, year, periodMonths],
  );

  const sectorData = useMemo(() => departuresBySector(metrics.listaDesligamentos), [metrics]);
  const monthlyData = useMemo(() => turnoverMonthlySeries(history, hotelId), [history, hotelId]);
  const hasHistory = monthlyData.some((row) => row.turnover !== null);

  const ranking = useMemo(() => {
    return rhHotels
      .map((h) => {
        const emps = allEmployees.filter((e) => e.hotel_id === h.id);
        const m = calcMetrics(emps, month, year, periodMonths);
        return { hotel: h, pctRotatividade: m.pctRotatividade, total: m.total, hasData: emps.length > 0 };
      })
      .sort((a, b) => b.pctRotatividade - a.pctRotatividade);
  }, [rhHotels, allEmployees, month, year, periodMonths]);
  const hotelData = ranking.map((row) => ({ name: row.hotel.name, turnover: row.hasData ? row.pctRotatividade : null }));

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
        <KpiCard label="% Turnover" value={formatPct(metrics.pctRotatividade)} />
        <KpiCard label="Tempo de casa" value={`${metrics.tempoCasaMedio.toFixed(1)} a`} sub="médio (ativos)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountChart title={periodMonths === 1 ? "Motivos de desligamento (no mês)" : "Motivos de desligamento (no período)"} data={reasonData} loading={reasonsLoading} error={reasonsError} />
        <CountChart title="Desligamento por setor" data={sectorData} loading={isLoading} error={isError} />
      </div>

      <section className="space-y-3 min-w-0">
        <h2 className="text-sm font-semibold">Evolução do turnover</h2>
        {historyLoading ? <ChartMessage text="Carregando histórico…" /> : historyError ? <ChartMessage text="Não foi possível carregar o histórico." /> : !hasHistory ? <ChartMessage text="Sem dados no período" /> : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthlyData} margin={{ top: 12, right: 20, left: 0, bottom: 12 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" fontSize={11} minTickGap={25} />
              <YAxis fontSize={12} tickFormatter={(value) => `${value}%`} />
              <Tooltip formatter={(value: number) => formatPct(value)} />
              <Line name="Turnover" type="linear" dataKey="turnover" stroke={BAR_COLOR} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="space-y-3 min-w-0">
        <h2 className="text-sm font-semibold">Turnover por hotel</h2>
        {isLoading ? <ChartMessage text="Carregando hotéis…" /> : isError ? <ChartMessage text="Não foi possível carregar os hotéis." /> : !ranking.some((row) => row.hasData) ? <ChartMessage text="Sem dados no período" /> : (
          <ResponsiveContainer width="100%" height={Math.max(240, hotelData.length * 44)}>
            <BarChart data={hotelData} layout="vertical" margin={{ top: 8, right: 25, left: 0, bottom: 8 }}>
              <XAxis type="number" fontSize={12} tickFormatter={(value) => `${value}%`} />
              <YAxis type="category" dataKey="name" width={150} interval={0} tick={<HotelAxisTick />} />
              <Tooltip formatter={(value: number) => formatPct(value)} />
              <Bar name="Turnover" dataKey="turnover" fill={BAR_COLOR} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="space-y-3 min-w-0">
        <h2 className="text-sm font-semibold">Admissões x Desligamentos por mês</h2>
        {historyLoading ? <ChartMessage text="Carregando histórico…" /> : historyError ? <ChartMessage text="Não foi possível carregar o histórico." /> : !hasHistory ? <ChartMessage text="Sem dados no período" /> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyData} margin={{ top: 12, right: 20, left: 0, bottom: 12 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" fontSize={11} minTickGap={25} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip /><Legend />
              <Bar name="Admissões" dataKey="admitted" fill={BAR_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar name="Desligamentos" dataKey="terminated" fill={SECONDARY_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Ranking modal */}
      <Dialog open={rankOpen} onOpenChange={setRankOpen}>
        <DialogContent className="max-w-lg max-h-[85dvh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Ranking por % turnover</DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-border min-h-0 max-h-[60dvh] overflow-y-auto pr-2">
            {ranking.length === 0 && <p className="text-sm text-muted-foreground py-4">Sem dados suficientes.</p>}
            {ranking.map((r, i) => (
              <div key={r.hotel.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="outline" className="w-7 justify-center">{i + 1}</Badge>
                  <div>
                    <p className="text-sm font-medium">{r.hotel.name}</p>
                    <p className="text-xs text-muted-foreground">{r.total} colaborador(es)</p>
                  </div>
                </div>
                <p className="text-sm font-semibold">{r.hasData ? formatPct(r.pctRotatividade) : "—"}</p>
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
                      <td className="py-2">{e.department || e.position || "—"}</td>
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
