import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, TrendingUp, Wallet, ArrowDownCircle,
  ArrowUpCircle, Send, Users, Target,
  CheckCircle2, ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useClosings } from "@/hooks/useClosings";
import { useAllApEntries } from "@/hooks/useAccountsPayable";
import { useOpenFolioEntries } from "@/hooks/useAccountsReceivable";
import { usePendingNotificationCount } from "@/hooks/useNotifications";
import { useRhCalendarDates } from "@/hooks/useRh";
import { CalendarDays } from "lucide-react";
import { NavLink } from "react-router-dom";

interface TodoItem {
  dot: "red" | "amber" | "blue" | "green";
  text: string;
  meta: string;
  url: string;
}

interface ModuleCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  url: string;
  badge?: string;
  badgeTone?: "pending" | "ok" | "info" | "soon";
  accent?: boolean;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatDate() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function DotColor({ tone }: { tone: TodoItem["dot"] }) {
  const colors = {
    red: "bg-destructive",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    green: "bg-emerald-500",
  };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colors[tone]}`} />;
}

function TodoList({ items }: { items: TodoItem[] }) {
  const navigate = useNavigate();
  if (items.length === 0) return (
    <div className="flex items-center gap-2 py-3 px-4 text-sm text-muted-foreground">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      Tudo em dia! Nenhuma pendência no momento.
    </div>
  );
  return (
    <div className="divide-y divide-border">
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => navigate(item.url)}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left"
        >
          <DotColor tone={item.dot} />
          <span className="flex-1 text-foreground">{item.text}</span>
          <span className="text-xs text-muted-foreground shrink-0">{item.meta}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}

function ModuleGrid({ modules }: { modules: ModuleCard[] }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {modules.map((m, i) => (
        <button
          key={i}
          onClick={() => navigate(m.url)}
          className={`text-left p-4 rounded-lg border bg-card hover:border-accent hover:shadow-soft transition-all ${m.accent ? "border-l-2 border-l-accent" : ""}`}
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="h-8 w-8 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
              {m.icon}
            </div>
            {m.badge && (
              <Badge
                variant="outline"
                className={
                  m.badgeTone === "pending"
                    ? "border-amber-500/40 text-amber-700 dark:text-amber-400 text-[10px]"
                    : m.badgeTone === "ok"
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px]"
                    : m.badgeTone === "soon"
                    ? "text-muted-foreground text-[10px]"
                    : "border-blue-500/40 text-blue-700 dark:text-blue-400 text-[10px]"
                }
              >
                {m.badge}
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold">{m.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const {
    profile, isMaster, isGg, roles,
    hasRole,
    allowedHotels,
  } = useAuth();
  const navigate = useNavigate();
  const isMarketingOnly = !isMaster && roles.length > 0 && roles.every((r) => r === "marketing");
  if (isMarketingOnly) {
    // Marketing users only have access to the Marketing area.
    setTimeout(() => navigate("/marketing/calendario", { replace: true }), 0);
    return null;
  }
  const { hotelId, month, year } = useModuleFilters("global");
  const today = todayIso();

  const { data: closings = [] } = useClosings({ hotelId, month, year });
  const { data: apEntries = [] } = useAllApEntries(
    isMaster || hasRole("financeiro")
  );
  const { data: ofEntries = [] } = useOpenFolioEntries();
  const { data: pendingNotifs = 0 } = usePendingNotificationCount();
  const { data: calendarDates = [] } = useRhCalendarDates();

  const upcomingDates = useMemo(() => {
    const now = new Date();
    const todayKey = (now.getMonth() + 1) * 100 + now.getDate();
    const list: { title: string; key: number; daysAhead: number }[] = [];
    for (const d of calendarDates) {
      const mm = d.date_month;
      const dd = d.date_day;
      if (!mm || !dd) continue;
      const key = mm * 100 + dd;
      const year = key < todayKey ? now.getFullYear() + 1 : now.getFullYear();
      const dt = new Date(year, mm - 1, dd);
      const diff = Math.round((dt.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
      if (diff >= 0 && diff <= 7) list.push({ title: d.title, key, daysAhead: diff });
    }
    return list.sort((a, b) => a.daysAhead - b.daysAhead);
  }, [calendarDates]);

  const closingStats = useMemo(() => {
    let returned = 0, waitingGop = 0, waitingMe = 0, waitingFernando = 0, waitingFernandoCarta = 0;
    for (const c of closings) {
      if ([c.status_dre, c.status_carta].includes("devolvido")) returned++;
      if (c.status_dre === "aguardando_gop") waitingGop++;
      if (c.status_dre === "aguardando_gg" || c.status_carta === "aguardando_gg") waitingMe++;
      if (c.status_dre === "aguardando_fernando") waitingFernando++;
      if (c.status_carta === "aguardando_fernando") waitingFernandoCarta++;
    }
    return { returned, waitingGop, waitingMe, waitingFernando, waitingFernandoCarta };
  }, [closings]);

  const apStats = useMemo(() => {
    const scoped = isGg && allowedHotels[0]
      ? apEntries.filter((e) => e.hotel_id === allowedHotels[0].id)
      : apEntries;
    const overdue = scoped.filter(
      (e) => e.due_date && e.due_date < today && e.gg_approval !== "rejected"
    ).length;
    const noApproval = scoped.filter(
      (e) => e.gg_approval === "pending" && e.payment_status === "em_aprovacao"
    ).length;
    return { overdue, noApproval };
  }, [apEntries, today, isGg, allowedHotels]);

  const ofStats = useMemo(() => {
    const scoped = isGg && allowedHotels[0]
      ? ofEntries.filter((e) => e.hotel_id === allowedHotels[0].id)
      : ofEntries;
    return scoped.length;
  }, [ofEntries, isGg, allowedHotels]);

  const todoItems = useMemo((): TodoItem[] => {
    const items: TodoItem[] = [];

    const isFernando = hasRole("fernando");

    if (isMaster || hasRole("gop") || hasRole("controladoria")) {
      if (closingStats.returned > 0)
        items.push({ dot: "red", text: `${closingStats.returned} DRE(s) devolvida(s)`, meta: "Fechamento", url: "/fechamento" });
      if (closingStats.waitingGop > 0 && (isMaster || hasRole("gop")))
        items.push({ dot: "amber", text: `${closingStats.waitingGop} DRE(s) aguardando aprovação GOP`, meta: "Fechamento", url: "/fechamento/dre" });
      if (apStats.overdue > 0 && (isMaster || hasRole("financeiro")))
        items.push({ dot: "red", text: `${apStats.overdue} lançamentos vencidos`, meta: "Contas a Pagar", url: "/financeiro/contas-pagar" });
      if (ofStats > 0 && (isMaster || hasRole("financeiro")))
        items.push({ dot: "blue", text: `${ofStats} folios em aberto`, meta: "Open Folio", url: "/financeiro/contas-receber" });
      if (pendingNotifs > 0)
        items.push({ dot: "amber", text: `${pendingNotifs} notificação(ões) pendente(s)`, meta: "Notificações", url: "/configuracoes/notificacoes" });
    }

    if (isFernando) {
      if (closingStats.waitingFernando > 0)
        items.push({ dot: "amber", text: `${closingStats.waitingFernando} DRE(s) aguardando sua aprovação final`, meta: "Fechamento", url: "/fechamento" });
      if (closingStats.waitingFernandoCarta > 0)
        items.push({ dot: "amber", text: `${closingStats.waitingFernandoCarta} Carta(s) aguardando sua aprovação`, meta: "Carta", url: "/fechamento/carta" });
    }

    if (isGg) {
      if (closingStats.waitingMe > 0)
        items.push({ dot: "amber", text: `Fechamento aguardando sua ação`, meta: "Fechamento", url: "/fechamento" });
      if (ofStats > 0)
        items.push({ dot: "blue", text: `${ofStats} folio(s) em aberto no seu hotel`, meta: "Open Folio", url: "/financeiro/contas-receber" });
    }

    if (hasRole("financeiro")) {
      if (apStats.overdue > 0)
        items.push({ dot: "red", text: `${apStats.overdue} lançamentos vencidos`, meta: "Contas a Pagar", url: "/financeiro/contas-pagar" });
      if (apStats.noApproval > 0)
        items.push({ dot: "amber", text: `${apStats.noApproval} lançamentos sem aprovação GG`, meta: "Contas a Pagar", url: "/financeiro/contas-pagar" });
      if (ofStats > 0)
        items.push({ dot: "blue", text: `${ofStats} folios em aberto`, meta: "Open Folio", url: "/financeiro/contas-receber" });
    }

    if (hasRole("ri")) {
      const readyToSend = closings.filter(
        (c) => c.status_dre === "aprovado" && c.status_carta === "aprovado" && c.status_envio !== "aprovado"
      ).length;
      if (readyToSend > 0)
        items.push({ dot: "green", text: `${readyToSend} pacote(s) prontos para envio`, meta: "Envio", url: "/fechamento/envio" });
    }

    return items;
  }, [closingStats, apStats, ofStats, pendingNotifs, isMaster, isGg, hasRole, closings]);

  const moduleCards = useMemo((): ModuleCard[] => {
    const cards: ModuleCard[] = [];

    if (isMaster || hasRole("gop") || hasRole("gg") || hasRole("controladoria") || hasRole("ri") || hasRole("fernando")) {
      cards.push({
        icon: <ClipboardList className="h-4 w-4" />,
        title: "Fechamento",
        description: "DRE, Carta ao Investidor e workflow mensal",
        url: "/fechamento",
        accent: true,
        badge: closingStats.returned > 0 ? `${closingStats.returned} devolvida(s)` : undefined,
        badgeTone: "pending",
      });
    }

    if (isMaster || hasRole("financeiro")) {
      cards.push({
        icon: <ArrowUpCircle className="h-4 w-4" />,
        title: "Contas a Pagar",
        description: "Lançamentos, aprovações e status de pagamento",
        url: "/financeiro/contas-pagar",
        accent: hasRole("financeiro") && !isMaster,
        badge: apStats.overdue > 0 ? `${apStats.overdue} vencidos` : undefined,
        badgeTone: "pending",
      });
    }

    if (isMaster || hasRole("financeiro") || hasRole("gg")) {
      cards.push({
        icon: <ArrowDownCircle className="h-4 w-4" />,
        title: "Contas a Receber",
        description: "A faturar e Open Folio",
        url: "/financeiro/contas-receber",
        badge: ofStats > 0 ? `${ofStats} em aberto` : undefined,
        badgeTone: "info",
      });
    }

    if (isMaster || hasRole("gop") || hasRole("gg") || hasRole("controladoria") || hasRole("operacoes") || hasRole("viewer")) {
      cards.push({
        icon: <TrendingUp className="h-4 w-4" />,
        title: "Indicadores DRE",
        description: "KPIs históricos dos hotéis",
        url: "/indicadores",
      });
    }

    if (isMaster || hasRole("ri")) {
      cards.push({
        icon: <Send className="h-4 w-4" />,
        title: "Envio",
        description: "Envio dos pacotes ao investidor",
        url: "/fechamento/envio",
        accent: hasRole("ri") && !isMaster,
      });
    }

    if (isMaster || hasRole("financeiro")) {
      cards.push({
        icon: <Wallet className="h-4 w-4" />,
        title: "Visão Geral",
        description: "Dashboard consolidado financeiro",
        url: "/financeiro",
      });
    }

    if (isMaster || hasRole("gop") || hasRole("gg") || hasRole("operacoes") || hasRole("viewer")) {
      cards.push({
        icon: <Target className="h-4 w-4" />,
        title: "Metas GG",
        description: "Acompanhamento de metas por hotel",
        url: "/metas",
        badge: "Em breve",
        badgeTone: "soon",
      });
    }

    if (isMaster || hasRole("rh") || hasRole("gop") || hasRole("gg") || hasRole("operacoes") || hasRole("viewer")) {
      cards.push({
        icon: <Users className="h-4 w-4" />,
        title: "Turnover & Rotatividade",
        description: "Dashboard de RH por hotel",
        url: "/rh/turnover",
        badge: "Em breve",
        badgeTone: "soon",
        accent: hasRole("rh") && !isMaster,
      });
    }

    return cards;
  }, [isMaster, isGg, hasRole, closingStats, apStats, ofStats]);

  const name = profile?.display_name ?? profile?.email?.split("@")[0] ?? "";

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">
          Sistema Falcon
        </p>
        <h1 className="text-3xl font-semibold">
          {greetingByHour()}, {name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 capitalize">
          {formatDate()}
          {isGg && allowedHotels[0] && (
            <span className="ml-2 text-accent font-medium">· {allowedHotels[0].name}</span>
          )}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          O que precisa da sua atenção
        </p>
        <Card className="shadow-soft overflow-hidden">
          <TodoList items={todoItems} />
        </Card>
      </div>

      {upcomingDates.length > 0 && (
        <NavLink
          to="/rh/calendario"
          className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:border-accent hover:shadow-soft transition-all"
        >
          <div className="h-8 w-8 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Próximas datas comemorativas
            </p>
            <div className="flex flex-wrap gap-2">
              {upcomingDates.map((d) => (
                <span key={d.key + d.title} className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                  <span className="font-semibold mr-1">
                    {d.daysAhead === 0 ? "hoje" : `${d.daysAhead}d`}
                  </span>
                  {d.title}
                </span>
              ))}
            </div>
          </div>
        </NavLink>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Acesso rápido
        </p>
        <ModuleGrid modules={moduleCards} />
      </div>
    </div>
  );
}
