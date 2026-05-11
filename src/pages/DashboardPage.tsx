import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useClosings } from "@/hooks/useClosings";
import { MONTHS_PT, hotelSkipsCarta } from "@/lib/constants";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  Mail,
  Wallet,
  Hotel,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

export default function DashboardPage() {
  const { profile, isMaster, allowedHotels } = useAuth();
  const { hotelId, month, year } = useModuleFilters("global");
  const { data: closings = [] } = useClosings({ hotelId, month, year });

  const stats = useMemo(() => {
    let approved = 0, inProgress = 0, pending = 0, returned = 0;
    for (const c of closings) {
      const allDone =
        c.status_dre === "aprovado" &&
        (hotelSkipsCarta(c.hotel_id) || c.status_carta === "aprovado" || c.status_carta === "nao_aplicavel") &&
        (c.status_financeiro === "aprovado" || c.status_financeiro === "sem_distribuicao") &&
        c.status_envio === "aprovado";
      const anyReturned = [c.status_dre, c.status_carta, c.status_financeiro, c.status_envio].includes("devolvido");
      const anyStarted = c.status_dre !== "nao_iniciado";
      if (allDone) approved++;
      else if (anyReturned) returned++;
      else if (anyStarted) inProgress++;
      else pending++;
    }
    return { approved, inProgress, pending, returned, total: closings.length || allowedHotels.length };
  }, [closings, allowedHotels.length]);

  const greeting = `Olá, ${profile?.display_name ?? profile?.email?.split("@")[0] ?? ""}`;

  const modules = [
    { title: "Fechamento", desc: "Workflow mensal de DRE, Carta e Financeiro", icon: FileSpreadsheet, to: "/fechamento", available: true },
    { title: "Carta ao Investidor", desc: "Geração e revisão das cartas mensais", icon: Mail, to: "/carta", available: true },
    { title: "Financeiro", desc: "Distribuição mensal aos investidores", icon: Wallet, to: "/financeiro", available: true },
    { title: "Hotéis", desc: "Cadastro e gestão da rede", icon: Hotel, to: "/hoteis", available: true },
    { title: "Contas a Pagar", desc: "Gestão de fornecedores e pagamentos", icon: Wallet, to: "/contas-pagar", available: false },
    { title: "Contas a Receber", desc: "Recebíveis e conciliações", icon: Wallet, to: "/contas-receber", available: false },
    { title: "Indicadores DRE", desc: "Visão consolidada de performance", icon: FileSpreadsheet, to: "/indicadores", available: false },
    { title: "Metas GG", desc: "Acompanhamento de metas operacionais", icon: CheckCircle2, to: "/metas", available: false },
    { title: "RH & People", desc: "Pessoas, turnover e clima", icon: CheckCircle2, to: "/rh", available: false },
    { title: "Controladoria", desc: "Auditoria e conformidade", icon: CheckCircle2, to: "/controladoria", available: false },
  ];

  return (
    <div className="space-y-8 max-w-[1400px]">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Dashboard</p>
        <h1 className="text-3xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_PT[month - 1]} de {year} · {isMaster ? "Visão Master" : `${allowedHotels.length} ${allowedHotels.length === 1 ? "hotel acessível" : "hotéis acessíveis"}`}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Resumo do Fechamento · {MONTHS_PT[month - 1]} / {year}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Hotéis no período" value={stats.total} icon={<FileSpreadsheet className="h-4 w-4 text-accent" />} />
          <StatCard label="Concluídos" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-success" />} tone="success" />
          <StatCard label="Em andamento" value={stats.inProgress} icon={<Clock className="h-4 w-4 text-primary" />} tone="primary" />
          <StatCard label="Devolvidos" value={stats.returned} icon={<AlertCircle className="h-4 w-4 text-destructive" />} tone="destructive" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Módulos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m) => {
            const Icon = m.icon;
            const inner = (
              <Card className={`p-5 shadow-soft h-full transition-colors ${m.available ? "hover:border-accent cursor-pointer" : "opacity-70"}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  {m.available ? (
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Em breve
                    </span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-1">{m.title}</h3>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </Card>
            );
            return m.available ? (
              <Link key={m.to} to={m.to}>{inner}</Link>
            ) : (
              <div key={m.to}>{inner}</div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label, value, icon, tone = "neutral",
}: { label: string; value: number; icon: React.ReactNode; tone?: "neutral" | "success" | "primary" | "destructive" }) {
  const toneClass: Record<string, string> = {
    neutral: "text-foreground", success: "text-success", primary: "text-primary", destructive: "text-destructive",
  };
  return (
    <Card className="p-5 shadow-soft">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <p className={`text-3xl font-semibold ${toneClass[tone]}`}>{value}</p>
    </Card>
  );
}
