import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useClosings } from "@/hooks/useClosings";
import { ClosingTable } from "@/components/closings/ClosingTable";
import { MONTHS_PT, hotelSkipsCarta } from "@/lib/constants";
import { CheckCircle2, Clock, AlertCircle, FileSpreadsheet } from "lucide-react";
import { useMemo } from "react";

export default function Index() {
  const { profile, isMaster, allowedHotels } = useAuth();
  const { hotelId, month, year } = useFilters();
  const { data: closings = [] } = useClosings({ hotelId, month, year });

  const stats = useMemo(() => {
    let approved = 0;
    let inProgress = 0;
    let pending = 0;
    let returned = 0;
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

  return (
    <div className="space-y-6 max-w-[1400px]">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Workflow de Fechamento
        </p>
        <h1 className="text-3xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_PT[month - 1]} de {year} · {isMaster ? "Visão Master" : `${allowedHotels.length} ${allowedHotels.length === 1 ? "hotel acessível" : "hotéis acessíveis"}`}
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Hotéis no período" value={stats.total} icon={<FileSpreadsheet className="h-4 w-4 text-accent" />} />
        <StatCard label="Concluídos" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-success" />} tone="success" />
        <StatCard label="Em andamento" value={stats.inProgress} icon={<Clock className="h-4 w-4 text-primary" />} tone="primary" />
        <StatCard label="Devolvidos" value={stats.returned} icon={<AlertCircle className="h-4 w-4 text-destructive" />} tone="destructive" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Fechamentos · {MONTHS_PT[month - 1]} / {year}
          </h2>
        </div>
        <ClosingTable hotelId={hotelId} month={month} year={year} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "neutral" | "success" | "primary" | "destructive";
}) {
  const toneClass: Record<string, string> = {
    neutral: "text-foreground",
    success: "text-success",
    primary: "text-primary",
    destructive: "text-destructive",
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
