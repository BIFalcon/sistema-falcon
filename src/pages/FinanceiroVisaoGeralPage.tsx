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
  TrendingUp,
  CreditCard,
  Clock,
  Hourglass,
  Pencil,
} from "lucide-react";
import { fmtBRL } from "@/lib/formatters";
import { BrDateInput } from "@/components/ui/br-date-input";

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

  // Filtros globais (header) — compartilhados com Contas a Pagar
  const { hotelId, dateFrom, dateTo } = useModuleFilters("financeiro");
  const hotelFilter = hotelId ?? "all";

  // Dados
  const { data: apEntries = [] } = useAllApEntries();
  const { data: toInvoice = [] } = useToInvoiceEntries({ hotelId: null });
  const { data: openFolio = [] } = useOpenFolioEntries();

  // Juros pagos: lançamentos pagos ficam arquivados, então precisam ser
  // buscados separadamente para somar os juros do período.
  const { data: paidEntries = [] } = useQuery({
    queryKey: ["ap-paid-all-juros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ap_entries")
        .select("hotel_id,payment_status,payment_paid_at,paid_interest")
        .eq("payment_status", "pago")
        .not("paid_interest", "is", null)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as Array<{
        hotel_id: string | null;
        payment_status: string;
        payment_paid_at: string | null;
        paid_interest: number | null;
      }>;
    },
  });

  // Saldos bancários (Itaú + Santander) — sem filtro de data, mais recente por banco
  const { data: bankBalances = [] } = useQuery({
    queryKey: ["ap-bank-balance-vg", hotelFilter],
    enabled: hotelFilter !== "all",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ap_bank_balance")
        .select("bank_name,amount,balance_date,hotel_id")
        .eq("hotel_id", hotelFilter)
        .order("balance_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        bank_name: string;
        amount: number;
        balance_date: string;
        hotel_id: string;
      }>;
    },
  });

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
  const paidScoped = useMemo(
    () => filterByScope(paidEntries),
    [paidEntries, hotelFilter, seesAllHotels, restrictedHotelIds],
  );

  // ===== Cards principais =====
  const todayIso = new Date().toISOString().slice(0, 10);

  // A pagar: vencimento >= hoje. Com filtro, respeita o range.
  const totalAPagar = useMemo(
    () =>
      apScoped
        .filter((e) => {
          if (e.payment_status === "pago") return false;
          if (!e.due_date || e.due_date < todayIso) return false;
          if (e.gg_approval === "rejected") return false;
          if (dateFrom && e.due_date < dateFrom) return false;
          if (dateTo && e.due_date > dateTo) return false;
          return true;
        })
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, todayIso, dateFrom, dateTo],
  );

  // Em atraso: vencidos, NUNCA filtra por data.
  const totalVencido = useMemo(
    () =>
      apScoped
        .filter(
          (e) =>
            e.due_date &&
            e.due_date < todayIso &&
            e.payment_status !== "pago" &&
            e.gg_approval !== "rejected",
        )
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [apScoped, todayIso],
  );

  const totalGeralAPagar = totalAPagar + totalVencido;

  // A faturar: usa estimated_due_date. Sem filtro = tudo.
  const totalAFaturar = useMemo(
    () =>
      tiScoped
        .filter((e) => {
          if (dateFrom && e.estimated_due_date && e.estimated_due_date < dateFrom)
            return false;
          if (dateTo && e.estimated_due_date && e.estimated_due_date > dateTo)
            return false;
          // sem data e sem filtro = inclui
          if (!e.estimated_due_date && (dateFrom || dateTo)) return false;
          return true;
        })
        .reduce((s, e) => s + Number(e.ar_open ?? e.amount ?? 0), 0),
    [tiScoped, dateFrom, dateTo],
  );

  // Open Folio: NUNCA filtra — sempre total.
  const totalOpenFolio = useMemo(
    () => ofScoped.reduce((s, e) => s + Number(e.balance ?? 0), 0),
    [ofScoped],
  );

  // Saldo em conta: soma do saldo mais recente por banco (Itaú + Santander), sem filtro.
  const saldoConta = useMemo(() => {
    const latest = new Map<string, number>();
    for (const b of bankBalances) {
      if (!latest.has(b.bank_name)) latest.set(b.bank_name, Number(b.amount ?? 0));
    }
    return Array.from(latest.values()).reduce((s, v) => s + v, 0);
  }, [bankBalances]);

  // Saldo líquido: Saldo conta − Total a pagar + Open Folio.
  const saldoLiquido = saldoConta - totalGeralAPagar + totalOpenFolio;

  // ===== Encargos financeiros (filtro próprio) =====
  const [anticDateFrom, setAnticDateFrom] = useState("");
  const [anticDateTo, setAnticDateTo] = useState("");

  // Juros pagos: por data efetiva do pagamento, filtro próprio.
  const jurosPagos = useMemo(
    () =>
      paidScoped
        .filter((e) => {
          if (!e.paid_interest || Number(e.paid_interest) === 0) return false;
          if (e.payment_status !== "pago") return false;
          const d = e.payment_paid_at?.slice(0, 10);
          if (!d) return false;
          if (anticDateFrom && d < anticDateFrom) return false;
          if (anticDateTo && d > anticDateTo) return false;
          return true;
        })
        .reduce((s, e) => s + Number(e.paid_interest ?? 0), 0),
    [paidScoped, anticDateFrom, anticDateTo],
  );

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="A pagar"
          value={fmtBRL(totalAPagar)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Em atraso"
          value={fmtBRL(totalVencido)}
          tone={totalVencido > 0 ? "destructive" : "default"}
          onClick={() => navigate("/financeiro/contas-pagar")}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total a pagar"
          value={fmtBRL(totalGeralAPagar)}
          tone={totalGeralAPagar > 0 ? "warning" : "default"}
          subtitle="A pagar + Em atraso"
          bold
        />
        <SummaryCard
          icon={<ArrowDownCircle className="h-4 w-4" />}
          label="A faturar"
          value={fmtBRL(totalAFaturar)}
          tone="default"
          onClick={() => navigate("/financeiro/contas-receber")}
        />
        <SummaryCard
          icon={<Hourglass className="h-4 w-4" />}
          label="Open Folio"
          value={fmtBRL(totalOpenFolio)}
          tone={totalOpenFolio > 0 ? "warning" : "default"}
          onClick={() => navigate("/financeiro/contas-receber")}
        />
        <SummaryCard
          icon={<CreditCard className="h-4 w-4" />}
          label="Saldo em conta"
          value={fmtBRL(saldoConta)}
          tone="default"
          subtitle={
            hotelFilter === "all"
              ? "Selecione um hotel"
              : "Itaú + Santander (mais recente)"
          }
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Saldo líquido"
          value={fmtBRL(saldoLiquido)}
          tone={saldoLiquido < 0 ? "destructive" : "default"}
          subtitle="Saldo conta − Total a pagar + Open Folio"
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

      {/* BLOCO 3 — Encargos financeiros (filtro próprio de período) */}
      <section className="space-y-3">
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-accent"><TrendingUp className="h-4 w-4" /></span>
              <h3 className="font-medium text-sm">Encargos financeiros</h3>
              {hotelFilter === "all" && (
                <span className="text-xs text-muted-foreground">
                  · Antecipação: selecione um hotel para informar
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <BrDateInput placeholder="De"
 value={anticDateFrom}
 onChange={setAnticDateFrom}
 className="w-36 h-8 text-xs"
 />
              <BrDateInput placeholder="Até"
 value={anticDateTo}
 onChange={setAnticDateTo}
 className="w-36 h-8 text-xs"
 />
            </div>
          </div>
          <AnticipationSection
            hotelId={hotelFilter === "all" ? null : hotelFilter}
            canEdit={canEditAnticipation}
            userId={user?.id ?? null}
            dateFrom={anticDateFrom}
            dateTo={anticDateTo}
            jurosPagos={jurosPagos}
          />
        </div>
      </section>
    </div>
  );
}

// ── Antecipação de recebíveis (acumulativa) ────────────────────────────────
interface ApAnticipationRow {
  id: string;
  hotel_id: string;
  anticipated_amount: number | null;
  valor_liquido: number | null;
  valor_descontado: number | null;
  data_antecipacao: string | null;
}

function AnticipationSection({
  hotelId,
  canEdit,
  userId,
  dateFrom,
  dateTo,
  jurosPagos,
}: {
  hotelId: string | null;
  canEdit: boolean;
  userId: string | null;
  dateFrom: string;
  dateTo: string;
  jurosPagos: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    anticipated_amount: "",
    valor_liquido: "",
    valor_descontado: "",
    data_antecipacao: "",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["ap-anticipation-list", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<ApAnticipationRow[]> => {
      const { data, error } = await supabase
        .from("ap_anticipation")
        .select("id,hotel_id,anticipated_amount,valor_liquido,valor_descontado,data_antecipacao")
        .eq("hotel_id", hotelId!)
        .order("data_antecipacao", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ApAnticipationRow[];
    },
  });

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const d = r.data_antecipacao;
        if (dateFrom && (!d || d < dateFrom)) return false;
        if (dateTo && (!d || d > dateTo)) return false;
        return true;
      }),
    [rows, dateFrom, dateTo],
  );

  const totalAntecipado = filtered.reduce(
    (s, r) => s + Number(r.anticipated_amount ?? 0),
    0,
  );
  const totalDescontado = filtered.reduce(
    (s, r) => s + Number(r.valor_descontado ?? 0),
    0,
  );

  const insert = useMutation({
    mutationFn: async () => {
      if (!hotelId || !userId) throw new Error("Selecione um hotel.");
      if (!form.data_antecipacao) throw new Error("Informe a data da antecipação.");
      const d = new Date(form.data_antecipacao + "T00:00:00");
      const payload = {
        hotel_id: hotelId,
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        anticipated_amount: parseFloat(form.anticipated_amount || "0"),
        valor_liquido: parseFloat(form.valor_liquido || "0"),
        valor_descontado: parseFloat(form.valor_descontado || "0"),
        data_antecipacao: form.data_antecipacao,
        informed_by: userId,
      };
      const { error } = await supabase
        .from("ap_anticipation")
        .insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-anticipation-list"] });
      toast.success("Antecipação registrada");
      setOpen(false);
      setForm({
        anticipated_amount: "",
        valor_liquido: "",
        valor_descontado: "",
        data_antecipacao: "",
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao salvar"),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          icon={<CreditCard className="h-4 w-4" />}
          label="Total antecipado"
          value={fmtBRL(totalAntecipado)}
          tone="default"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Valor descontado"
          value={fmtBRL(totalDescontado)}
          tone={totalDescontado > 0 ? "warning" : "default"}
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4" />}
          label="Juros pagos"
          value={fmtBRL(jurosPagos)}
          tone={jurosPagos > 0 ? "warning" : "default"}
        />
      </div>

      {canEdit && hotelId && (
        <div>
          {!open ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Nova antecipação
            </Button>
          ) : (
            <Card className="p-4 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Valor antecipado (R$)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.anticipated_amount}
                    onChange={(e) =>
                      setForm({ ...form, anticipated_amount: e.target.value })
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Valor líquido (R$)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_liquido}
                    onChange={(e) =>
                      setForm({ ...form, valor_liquido: e.target.value })
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Valor descontado (R$)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_descontado}
                    onChange={(e) =>
                      setForm({ ...form, valor_descontado: e.target.value })
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Data da antecipação
                  </label>
                  <BrDateInput value={form.data_antecipacao}
 onChange={(v) => setForm({ ...form, data_antecipacao: v })
 }
 className="h-8"
 />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => insert.mutate()} disabled={insert.isPending}>
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Cada registro é acumulado — não substitui os anteriores.
                Estes valores são informativos e não entram no saldo líquido.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  subtitle,
  onClick,
  bold,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "default" | "destructive" | "warning";
  subtitle?: string;
  onClick?: () => void;
  bold?: boolean;
}) {
  const toneClass =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "";
  const valueClass = `${tone === "destructive" ? "text-destructive" : ""} ${bold ? "font-bold" : "font-semibold"}`;
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`text-left p-4 rounded-lg border bg-card transition-all ${onClick ? "hover:border-accent hover:shadow-soft" : ""} ${toneClass}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className={`mt-2 text-2xl ${valueClass}`}>{value}</p>
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
