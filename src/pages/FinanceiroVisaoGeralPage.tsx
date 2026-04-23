import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import { useAllApEntries, useAllTodayBankBalances } from "@/hooks/useAccountsPayable";
import { useToInvoiceEntries, useOpenFolioEntries } from "@/hooks/useAccountsReceivable";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Wallet,
  Hourglass,
  TrendingUp,
  CreditCard,
  Sparkles,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

function brl(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function ymKey(iso: string) {
  return iso.slice(0, 7);
}
function startOfWeekIso(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0 dom .. 6 sab
  const diff = date.getDate() - day; // semana iniciando no domingo
  date.setDate(diff);
  return date.toISOString().slice(0, 10);
}
function endOfWeekIso(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() + (6 - day);
  date.setDate(diff);
  return date.toISOString().slice(0, 10);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[m - 1]}/${String(y).slice(2)}`;
}

/** Notas existentes (para identificar folios SEM justificativa) — RLS aplica. */
function useAllOpenFolioNotes() {
  return useQuery({
    queryKey: ["of-notes-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_open_folio_notes")
        .select("hotel_id, confirmation_number, created_at")
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function FinanceiroVisaoGeralPage() {
  const navigate = useNavigate();
  const { hasRole, isMaster, userHotels } = useAuth();
  const seesAllHotels =
    isMaster || hasRole("financeiro") || hasRole("controladoria") || hasRole("ri");
  const restrictedHotelIds: string[] | null = seesAllHotels
    ? null
    : userHotels.map((h) => h.id);

  const { data: allHotels = [] } = useAllHotels();
  const hotelById = useMemo(() => new Map(allHotels.map((h) => [h.id, h])), [allHotels]);

  // Filtros globais (header)
  const { hotelId, month, year } = useFilters();
  const hotelFilter = hotelId ?? "all";
  const period = `${year}-${String(month).padStart(2, "0")}`;

  // Dados
  const { data: apEntries = [], isLoading: apLoading } = useAllApEntries();
  const { data: bankBalances = [] } = useAllTodayBankBalances();
  const { data: toInvoice = [] } = useToInvoiceEntries({ hotelId: null });
  const { data: openFolio = [] } = useOpenFolioEntries();
  const { data: ofNotes = [] } = useAllOpenFolioNotes();

  // Filtro por hotel/aplicação de RLS no front
  const filterByScope = <T extends { hotel_id: string | null }>(arr: T[]) => {
    let r = arr;
    if (!seesAllHotels) {
      const allowed = new Set(restrictedHotelIds ?? []);
      r = r.filter((e) => e.hotel_id && allowed.has(e.hotel_id));
    }
    if (hotelFilter !== "all") {
      r = r.filter((e) => e.hotel_id === hotelFilter);
    }
    return r;
  };

  const apScoped = useMemo(() => filterByScope(apEntries), [apEntries, hotelFilter, seesAllHotels, restrictedHotelIds]);
  const tiScoped = useMemo(() => filterByScope(toInvoice), [toInvoice, hotelFilter, seesAllHotels, restrictedHotelIds]);
  const ofScoped = useMemo(() => filterByScope(openFolio), [openFolio, hotelFilter, seesAllHotels, restrictedHotelIds]);

  // ===== Cards superiores =====
  const today = todayIso();
  const totalDueToday = useMemo(
    () => apScoped.filter((e) => e.due_date === today && e.gg_approval !== "rejected")
                  .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, today],
  );
  const totalOverdue = useMemo(
    () => apScoped.filter((e) => e.due_date && e.due_date < today && e.gg_approval !== "rejected")
                  .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, today],
  );
  const totalToInvoiceMonth = useMemo(() => {
    return tiScoped
      .filter((e) => e.transaction_date && ymKey(e.transaction_date) === period)
      .reduce((s, e) => s + Number(e.ar_open ?? e.amount ?? 0), 0);
  }, [tiScoped, period]);
  const totalOpenFolio = useMemo(
    () => ofScoped.reduce((s, e) => s + Number(e.balance ?? 0), 0),
    [ofScoped],
  );

  // ===== AP — Ranking semanal =====
  const weekStart = startOfWeekIso();
  const weekEnd = endOfWeekIso();
  const apWeekRanking = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of apScoped) {
      if (!e.due_date || e.due_date < weekStart || e.due_date > weekEnd) continue;
      if (e.gg_approval === "rejected") continue;
      map.set(e.hotel_id, (map.get(e.hotel_id) ?? 0) + Number(e.amount ?? 0));
    }
    return Array.from(map.entries())
      .map(([id, total]) => ({ id, name: hotelById.get(id)?.name ?? id, total }))
      .sort((a, b) => b.total - a.total);
  }, [apScoped, weekStart, weekEnd, hotelById]);

  // Alertas críticos: hotéis com vencidos
  const overdueHotels = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const e of apScoped) {
      if (!e.due_date || e.due_date >= today) continue;
      if (e.gg_approval === "rejected") continue;
      const cur = map.get(e.hotel_id) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(e.amount ?? 0);
      map.set(e.hotel_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: hotelById.get(id)?.name ?? id, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [apScoped, today, hotelById]);

  // Alertas críticos: saldo bancário insuficiente (saldo informado < total a pagar nos próximos 7 dias)
  const insufficientBalance = useMemo(() => {
    const next7 = new Date();
    next7.setDate(next7.getDate() + 7);
    const next7Iso = next7.toISOString().slice(0, 10);
    const dueByHotel = new Map<string, number>();
    for (const e of apScoped) {
      if (!e.due_date || e.due_date > next7Iso || e.gg_approval === "rejected") continue;
      dueByHotel.set(e.hotel_id, (dueByHotel.get(e.hotel_id) ?? 0) + Number(e.amount ?? 0));
    }
    const balByHotel = new Map<string, number>();
    for (const b of bankBalances) {
      balByHotel.set(b.hotel_id, Number(b.amount ?? 0));
    }
    const out: { id: string; name: string; due: number; balance: number }[] = [];
    for (const [id, due] of dueByHotel) {
      const bal = balByHotel.get(id);
      if (bal != null && bal < due) {
        out.push({ id, name: hotelById.get(id)?.name ?? id, due, balance: bal });
      }
    }
    return out.sort((a, b) => (b.due - b.balance) - (a.due - a.balance));
  }, [apScoped, bankBalances, hotelById]);

  // ===== AR — Faturar últimos 3 meses + atual =====
  const monthsBars = useMemo(() => {
    const arr: { ym: string; total: number }[] = [];
    const base = new Date(period + "-01T00:00:00");
    for (let i = 3; i >= 0; i--) {
      const d = new Date(base);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const total = tiScoped
        .filter((e) => e.transaction_date && ymKey(e.transaction_date) === ym)
        .reduce((s, e) => s + Number(e.ar_open ?? e.amount ?? 0), 0);
      arr.push({ ym, total });
    }
    return arr;
  }, [tiScoped, period]);

  // ===== AR — Open Folio ranking =====
  const ofRanking = useMemo(() => {
    const map = new Map<string, { count: number; total: number; daysSum: number; daysCount: number }>();
    for (const e of ofScoped) {
      if (!e.hotel_id) continue;
      const cur = map.get(e.hotel_id) ?? { count: 0, total: 0, daysSum: 0, daysCount: 0 };
      cur.count++;
      cur.total += Number(e.balance ?? 0);
      if (e.days_open != null) {
        cur.daysSum += e.days_open;
        cur.daysCount++;
      }
      map.set(e.hotel_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({
        id,
        name: hotelById.get(id)?.name ?? id,
        count: v.count,
        total: v.total,
        avgDays: v.daysCount ? Math.round(v.daysSum / v.daysCount) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [ofScoped, hotelById]);

  // Hotéis com folios sem justificativa há mais de 48h
  const noteByKey = useMemo(() => {
    const set = new Set<string>();
    for (const n of ofNotes) set.add(`${n.hotel_id}|${n.confirmation_number}`);
    return set;
  }, [ofNotes]);
  const stalled48h = useMemo(() => {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const map = new Map<string, number>();
    for (const e of ofScoped) {
      if (!e.hotel_id || !e.confirmation_number) continue;
      const k = `${e.hotel_id}|${e.confirmation_number}`;
      if (noteByKey.has(k)) continue;
      // sem justificativa: considera "há mais de 48h" se days_open > 2 ou created_at antigo
      const ageOk = (e.days_open ?? 0) > 2;
      if (!ageOk) continue;
      map.set(e.hotel_id, (map.get(e.hotel_id) ?? 0) + 1);
    }
    return new Set(map.keys());
    void cutoff;
  }, [ofScoped, noteByKey]);

  const maxApBar = Math.max(1, ...apWeekRanking.map((r) => r.total));
  const maxOfBar = Math.max(1, ...ofRanking.map((r) => r.total));
  const maxMonthBar = Math.max(1, ...monthsBars.map((m) => m.total));

  // periodOptions: últimos 12 meses + próximos 2
  const periodOptions = useMemo(() => {
    const arr: string[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 11; i >= -2; i--) {
      const d = new Date(base);
      d.setMonth(d.getMonth() - i);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return arr;
  }, []);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Gestão · Financeiro</p>
        <h1 className="text-2xl font-semibold">Visão Geral</h1>
        <p className="text-sm text-muted-foreground">
          Dashboard executivo consolidando Contas a Pagar, Contas a Receber e indicadores financeiros.
        </p>
      </div>

      {/* Filtros */}
      <Card className="p-4 shadow-soft flex flex-wrap items-end gap-3">
        {!isGgOnly && (
          <div className="min-w-[220px]">
            <Label className="text-xs">Hotel</Label>
            <Select value={hotelFilter} onValueChange={setHotelFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os hotéis</SelectItem>
                {visibleHotels.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-w-[180px]">
          <Label className="text-xs">Período</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {periodOptions.map((ym) => (
                <SelectItem key={ym} value={ym}>{monthLabel(ym)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Cards superiores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="A pagar hoje"
          value={brl(totalDueToday)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Em atraso"
          value={brl(totalOverdue)}
          tone={totalOverdue > 0 ? "destructive" : "default"}
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<ArrowDownCircle className="h-4 w-4" />}
          label={`A faturar (${monthLabel(period)})`}
          value={brl(totalToInvoiceMonth)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-receber")}
        />
        <SummaryCard
          icon={<Hourglass className="h-4 w-4" />}
          label="Open Folio em aberto"
          value={brl(totalOpenFolio)}
          tone={totalOpenFolio > 0 ? "warning" : "default"}
          onClick={() => navigate("/financeiro/contas-receber")}
        />
      </div>

      {/* CONTAS A PAGAR */}
      <section className="space-y-3">
        <SectionHeader
          icon={<ArrowUpCircle className="h-4 w-4" />}
          title="Contas a Pagar"
          subtitle="Ranking da semana atual e alertas críticos"
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 shadow-soft lg:col-span-2 space-y-3">
            <h3 className="text-sm font-semibold">Ranking semanal por hotel</h3>
            {apLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : apWeekRanking.length === 0 ? (
              <EmptyHint text="Sem pagamentos previstos para esta semana." />
            ) : (
              <div className="space-y-2">
                {apWeekRanking.slice(0, 12).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate("/financeiro/contas-pagar")}
                    className="w-full flex items-center gap-3 group"
                  >
                    <div className="w-44 text-sm truncate text-left group-hover:text-accent transition-colors">{r.name}</div>
                    <div className="flex-1 h-7 rounded bg-muted/40 overflow-hidden">
                      <div
                        className="h-full bg-accent/80 flex items-center justify-end pr-2 text-[11px] font-semibold text-accent-foreground"
                        style={{ width: `${Math.max(2, (r.total / maxApBar) * 100)}%` }}
                      >
                        {brl(r.total)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5 shadow-soft space-y-3">
            <h3 className="text-sm font-semibold">Alertas críticos</h3>
            <div className="space-y-2">
              {overdueHotels.length === 0 && insufficientBalance.length === 0 && (
                <EmptyHint text="Sem alertas no momento." />
              )}
              {overdueHotels.slice(0, 5).map((h) => (
                <button
                  key={`ov-${h.id}`}
                  onClick={() => navigate("/financeiro/contas-pagar")}
                  className="w-full text-left p-2.5 rounded border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{h.name}</span>
                    <Badge variant="destructive" className="text-[9px] shrink-0">vencidos</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {h.count} lançamento(s) · <strong className="text-destructive">{brl(h.total)}</strong>
                  </p>
                </button>
              ))}
              {insufficientBalance.slice(0, 5).map((h) => (
                <button
                  key={`ib-${h.id}`}
                  onClick={() => navigate("/financeiro/contas-pagar")}
                  className="w-full text-left p-2.5 rounded border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{h.name}</span>
                    <Badge className="text-[9px] shrink-0 bg-amber-500 text-white hover:bg-amber-500/90">saldo baixo</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Saldo {brl(h.balance)} · 7d {brl(h.due)}
                  </p>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* CONTAS A RECEBER */}
      <section className="space-y-3">
        <SectionHeader
          icon={<ArrowDownCircle className="h-4 w-4" />}
          title="Contas a Receber"
          subtitle="Faturamento mensal e folios em aberto por hotel"
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 shadow-soft space-y-3">
            <h3 className="text-sm font-semibold">A faturar — últimos meses</h3>
            <div className="space-y-2">
              {monthsBars.map((m) => (
                <div
                  key={m.ym}
                  onClick={() => navigate("/financeiro/contas-receber")}
                  className="cursor-pointer"
                >
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">{monthLabel(m.ym)}</span>
                    <span className="font-semibold">{brl(m.total)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${(m.total / maxMonthBar) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5 shadow-soft lg:col-span-2 space-y-3">
            <h3 className="text-sm font-semibold">Open Folio por hotel</h3>
            {ofRanking.length === 0 ? (
              <EmptyHint text="Sem folios em aberto." />
            ) : (
              <div className="space-y-2">
                {ofRanking.slice(0, 10).map((r) => {
                  const tone =
                    r.avgDays > 90 ? "bg-destructive/15 text-destructive border-destructive/30"
                    : r.avgDays > 30 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
                  const stalled = stalled48h.has(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => navigate("/financeiro/contas-receber")}
                      className={`w-full text-left p-3 rounded border hover:border-accent transition-colors flex items-center gap-3 ${stalled ? "border-destructive/40 bg-destructive/5" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{r.name}</span>
                          {stalled && <Badge variant="destructive" className="text-[9px]">+48h sem just.</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{r.count} folio(s)</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{brl(r.total)}</p>
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${tone}`}>
                          média {r.avgDays}d
                        </span>
                      </div>
                      <div className="hidden md:block w-32 h-2 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-accent/70" style={{ width: `${(r.total / maxOfBar) * 100}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* JUROS & ANTECIPAÇÕES — placeholder */}
      <section className="space-y-3">
        <SectionHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Juros & Antecipações"
          subtitle="Em desenvolvimento"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlaceholderCard
            icon={<Sparkles className="h-4 w-4" />}
            title="Juros pagos por hotel"
            text="Dashboard de juros pagos por hotel — disponível em breve."
          />
          <PlaceholderCard
            icon={<Clock className="h-4 w-4" />}
            title="Antecipações de recebíveis"
            text="Antecipações de recebíveis — disponível em breve."
          />
        </div>
      </section>

      {/* INTEGRAÇÃO REDE — placeholder */}
      <section className="space-y-3">
        <SectionHeader
          icon={<CreditCard className="h-4 w-4" />}
          title="Integração Rede"
          subtitle="Aguardando conexão com a operadora"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlaceholderCard
            icon={<CreditCard className="h-4 w-4" />}
            title="Recebíveis de cartão"
            text="Recebíveis de cartão — disponível após integração com a Rede."
          />
          <PlaceholderCard
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Chargebacks"
            text="Chargebacks — disponível após integração com a Rede."
          />
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "default" | "destructive" | "warning";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "";
  const valueClass =
    tone === "destructive" ? "text-destructive" : "";
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-lg border bg-card hover:border-accent hover:shadow-soft transition-all ${toneClass}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </button>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function PlaceholderCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card className="p-5 shadow-soft border-dashed bg-muted/30 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon} {title}
        <Badge variant="outline" className="ml-auto text-[9px]">Em breve</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
    </Card>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground italic">{text}</p>;
}
