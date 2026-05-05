import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import { useAllApEntries } from "@/hooks/useAccountsPayable";
import { useToInvoiceEntries, useOpenFolioEntries } from "@/hooks/useAccountsReceivable";
import {
  ArrowDownCircle,
  AlertTriangle,
  Wallet,
  Hourglass,
  TrendingUp,
  CreditCard,
  Sparkles,
  Clock,
} from "lucide-react";
import { fmtBRL } from "@/lib/formatters";

export default function FinanceiroVisaoGeralPage() {
  const navigate = useNavigate();
  const { hasRole, isMaster, userHotels } = useAuth();
  const seesAllHotels =
    isMaster || hasRole("financeiro") || hasRole("controladoria") || hasRole("ri");
  const restrictedHotelIds: string[] | null = seesAllHotels
    ? null
    : userHotels.map((h) => h.id);

  const { data: allHotels = [] } = useAllHotels();
  void allHotels;

  // Filtros globais (header)
  const { hotelId, dateFrom, dateTo } = useFilters();
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
          <PlaceholderCard
            icon={<Sparkles className="h-4 w-4" />}
            title="Cashbacks"
            text="Cashbacks recebidos no período — disponível após integração com a Rede."
          />
        </div>
      </section>

      {/* BLOCO 3 — Encargos financeiros */}
      <section className="space-y-3">
        <SectionHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Encargos financeiros"
          subtitle="Disponível em breve"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PlaceholderCard
            icon={<Clock className="h-4 w-4" />}
            title="Juros pagos no período"
            text="Total de juros pagos no período selecionado — disponível em breve."
          />
          <PlaceholderCard
            icon={<Clock className="h-4 w-4" />}
            title="Antecipação de recebíveis"
            text="Valor antecipado no período — disponível em breve."
          />
          <PlaceholderCard
            icon={<Clock className="h-4 w-4" />}
            title="Taxa de antecipação"
            text="Taxa paga por antecipação no período — disponível em breve."
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
