// GG pode ver esta página (somente leitura — sem botões de ação).
// Dados já são filtrados pelo hotel do GG via allowedHotels no AuthContext.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import { useAllApEntries } from "@/hooks/useAccountsPayable";
import { useToInvoiceEntries, useOpenFolioEntries } from "@/hooks/useAccountsReceivable";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  AlertTriangle,
  Wallet,
  Hourglass,
  TrendingUp,
  CreditCard,
  Sparkles,
  Clock,
  Pencil,
} from "lucide-react";
import { fmtBRL } from "@/lib/formatters";

export default function FinanceiroVisaoGeralPage() {
  const navigate = useNavigate();
  const { user, hasRole, isMaster, userHotels } = useAuth();
  const seesAllHotels =
    isMaster || hasRole("financeiro") || hasRole("controladoria") || hasRole("ri");
  const canEditAnticipation = isMaster || hasRole("financeiro");
  const restrictedHotelIds: string[] | null = seesAllHotels
    ? null
    : userHotels.map((h) => h.id);

  const { data: allHotels = [] } = useAllHotels();
  void allHotels;

  // Filtros globais (header)
  const { hotelId, dateFrom, dateTo } = useModuleFilters("fechamento");
  const hotelFilter = hotelId ?? "all";

  // Dados
  const { data: apEntries = [] } = useAllApEntries();
  const { data: toInvoice = [] } = useToInvoiceEntries({ hotelId: null });
  const { data: openFolio = [] } = useOpenFolioEntries();

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

  const apScoped = useMemo(
    () => filterByScope(apEntries),
    [apEntries, hotelFilter, seesAllHotels, restrictedHotelIds],
  );
  const tiScoped = useMemo(
    () => filterByScope(toInvoice),
    [toInvoice, hotelFilter, seesAllHotels, restrictedHotelIds],
  );
  const ofScoped = useMemo(
    () => filterByScope(openFolio),
    [openFolio, hotelFilter, seesAllHotels, restrictedHotelIds],
  );

  // ===== Cards superiores (usam date range) =====
  const totalDuePeriod = useMemo(
    () =>
      apScoped
        .filter(
          (e) =>
            e.due_date &&
            e.due_date >= dateFrom &&
            e.due_date <= dateTo &&
            e.gg_approval !== "rejected",
        )
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, dateFrom, dateTo],
  );

  const totalOverdue = useMemo(
    () =>
      apScoped
        .filter(
          (e) =>
            e.due_date &&
            e.due_date < dateFrom &&
            e.gg_approval !== "rejected",
        )
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, dateFrom],
  );

  const totalOpenFolio = useMemo(
    () => ofScoped.reduce((s, e) => s + Number(e.balance ?? 0), 0),
    [ofScoped],
  );

  // TODO: quando contratos estiverem cadastrados, filtrar por
  // transaction_date + prazo_dias_contrato ao invés de transaction_date diretamente.
  const totalToInvoicePeriod = useMemo(
    () =>
      tiScoped
        .filter(
          (e) =>
            e.transaction_date &&
            e.transaction_date >= dateFrom &&
            e.transaction_date <= dateTo,
        )
        .reduce((s, e) => s + Number(e.ar_open ?? e.amount ?? 0), 0),
    [tiScoped, dateFrom, dateTo],
  );

  const saldoLiquido = totalOpenFolio - totalDuePeriod;

  // ===== Encargos financeiros =====
  // Juros pagos no período (apenas lançamentos pagos com juros)
  const jurosPagos = useMemo(
    () =>
      apScoped
        .filter(
          (e) =>
            e.payment_status === "pago" &&
            e.due_date &&
            e.due_date >= dateFrom &&
            e.due_date <= dateTo,
        )
        .reduce((s, e) => s + Number(e.paid_interest ?? 0), 0),
    [apScoped, dateFrom, dateTo],
  );

  // Antecipação: deriva mês/ano de dateFrom
  const period = useMemo(() => {
    const d = dateFrom ? new Date(dateFrom + "T00:00:00") : new Date();
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }, [dateFrom]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Gestão · Financeiro
        </p>
        <h1 className="text-2xl font-semibold">Visão Geral</h1>
        <p className="text-sm text-muted-foreground">
          Consolidado financeiro do período selecionado.
        </p>
      </div>

      {/* BLOCO 1 — Cards principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="A pagar no período"
          value={fmtBRL(totalDuePeriod)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Em atraso"
          value={fmtBRL(totalOverdue)}
          tone={totalOverdue > 0 ? "destructive" : "default"}
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<ArrowDownCircle className="h-4 w-4" />}
          label="A faturar no período"
          value={fmtBRL(totalToInvoicePeriod)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-receber")}
        />
        <SummaryCard
          icon={<Hourglass className="h-4 w-4" />}
          label="Open Folio em aberto"
          value={fmtBRL(totalOpenFolio)}
          tone={totalOpenFolio > 0 ? "warning" : "default"}
          onClick={() => navigate("/financeiro/contas-receber")}
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Saldo líquido"
          value={fmtBRL(saldoLiquido)}
          tone={saldoLiquido < 0 ? "destructive" : "default"}
          subtitle="A receber − A pagar"
        />
      </div>

      {/* BLOCO 2 — Recebíveis de cartão */}
      <section className="space-y-3">
        <SectionHeader
          icon={<CreditCard className="h-4 w-4" />}
          title="Recebíveis de cartão"
          subtitle="Disponível após integração com a Rede"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PlaceholderCard
            icon={<CreditCard className="h-4 w-4" />}
            title="Recebíveis de cartão"
            text="Total de recebíveis de cartão no período — disponível após integração com a Rede."
          />
          <PlaceholderCard
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Chargebacks"
            text="Chargebacks no período — disponível após integração com a Rede."
          />
        </div>
      </section>

      {/* BLOCO 3 — Encargos financeiros */}
      <section className="space-y-3">
        <SectionHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Encargos financeiros"
          subtitle={
            hotelFilter === "all"
              ? "Antecipação: selecione um hotel para informar"
              : undefined
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryCard
            icon={<Clock className="h-4 w-4" />}
            label="Juros pagos no período"
            value={fmtBRL(jurosPagos)}
            tone={jurosPagos > 0 ? "warning" : "default"}
          />
          <AnticipationCards
            hotelId={hotelFilter === "all" ? null : hotelFilter}
            year={period.year}
            month={period.month}
            canEdit={canEditAnticipation}
            userId={user?.id ?? null}
          />
        </div>
      </section>
    </div>
  );
}

// ── Antecipação de recebíveis ──────────────────────────────────────────────
interface ApAnticipationRow {
  id: string;
  hotel_id: string;
  month: number;
  year: number;
  anticipated_amount: number;
  anticipation_rate: number;
}

function AnticipationCards({
  hotelId,
  year,
  month,
  canEdit,
  userId,
}: {
  hotelId: string | null;
  year: number;
  month: number;
  canEdit: boolean;
  userId: string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [rateInput, setRateInput] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["ap-anticipation", year, month, hotelId],
    queryFn: async (): Promise<ApAnticipationRow[]> => {
      let q = supabase
        .from("ap_anticipation" as never)
        .select("*")
        .eq("year", year)
        .eq("month", month);
      if (hotelId) q = q.eq("hotel_id", hotelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ApAnticipationRow[];
    },
  });

  const totalAmount = rows.reduce((s, r) => s + Number(r.anticipated_amount ?? 0), 0);
  const avgRate =
    rows.length > 0
      ? rows.reduce((s, r) => s + Number(r.anticipation_rate ?? 0), 0) / rows.length
      : 0;

  const upsert = useMutation({
    mutationFn: async () => {
      if (!hotelId || !userId) throw new Error("Selecione um hotel.");
      const payload = {
        hotel_id: hotelId,
        month,
        year,
        anticipated_amount: parseFloat(amountInput || "0"),
        anticipation_rate: parseFloat(rateInput || "0"),
        informed_by: userId,
      };
      const { error } = await supabase
        .from("ap_anticipation" as never)
        .upsert(payload as never, { onConflict: "hotel_id,month,year" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-anticipation"] });
      toast.success("Antecipação atualizada");
      setEditing(false);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao salvar"),
  });

  const startEdit = () => {
    const current = rows[0];
    setAmountInput(current ? String(current.anticipated_amount ?? "") : "");
    setRateInput(current ? String(current.anticipation_rate ?? "") : "");
    setEditing(true);
  };

  const canEditThis = canEdit && !!hotelId;

  return (
    <>
      <Card className="p-4 shadow-soft space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <CreditCard className="h-4 w-4" /> Antecipação de recebíveis
          {canEditThis && !editing && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs gap-1"
              onClick={startEdit}
            >
              <Pencil className="h-3 w-3" /> Editar
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">
                Valor antecipado
              </label>
              <Input
                type="number"
                step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0,00"
                className="h-8"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">
                Taxa (ex: 0.0235 = 2,35%)
              </label>
              <Input
                type="number"
                step="0.0001"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                placeholder="0.0000"
                className="h-8"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => upsert.mutate()}
                disabled={upsert.isPending}
              >
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-2xl font-semibold">{fmtBRL(totalAmount)}</p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Período: {String(month).padStart(2, "0")}/{year}
          {!hotelId && " · todos os hotéis (soma)"}
        </p>
      </Card>

      <Card className="p-4 shadow-soft space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> Taxa de antecipação
        </div>
        <p className="mt-1 text-2xl font-semibold">
          {(avgRate * 100).toFixed(2)}%
        </p>
        <p className="text-[10px] text-muted-foreground">
          {hotelId
            ? "Taxa cobrada no período"
            : "Taxa média entre os hotéis no período"}
        </p>
      </Card>
    </>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "default" | "destructive" | "warning";
  subtitle?: string;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "";
  const valueClass = tone === "destructive" ? "text-destructive" : "";
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`text-left p-4 rounded-lg border bg-card transition-all ${onClick ? "hover:border-accent hover:shadow-soft" : ""} ${toneClass}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
      )}
    </Wrapper>
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
