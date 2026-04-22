import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { ROLE_LABELS, MONTHS_PT } from "@/lib/constants";
import { Building2, Hotel as HotelIcon, ShieldCheck, CalendarDays } from "lucide-react";

export default function Index() {
  const { profile, roles, isMaster, allowedHotels } = useAuth();
  const { hotelId, month, year } = useFilters();

  const hotelName =
    hotelId
      ? allowedHotels.find((h) => h.id === hotelId)?.name
      : isMaster
        ? "Todos os hotéis"
        : "—";

  const greeting = `Bem-vindo, ${profile?.display_name ?? profile?.email?.split("@")[0] ?? ""}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Sistema Falcon
        </p>
        <h1 className="text-3xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          Plataforma unificada de gestão da Falcon Hotéis.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Papéis</span>
            <ShieldCheck className="h-4 w-4 text-accent" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isMaster && <Badge className="bg-accent text-accent-foreground hover:bg-accent">Master</Badge>}
            {roles.map((r) => (
              <Badge key={r} variant="secondary">{ROLE_LABELS[r]}</Badge>
            ))}
          </div>
        </Card>

        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hotel selecionado</span>
            <HotelIcon className="h-4 w-4 text-accent" />
          </div>
          <p className="text-lg font-semibold text-foreground truncate">{hotelName}</p>
        </Card>

        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Período</span>
            <CalendarDays className="h-4 w-4 text-accent" />
          </div>
          <p className="text-lg font-semibold text-foreground">{MONTHS_PT[month - 1]} / {year}</p>
        </Card>

        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hotéis acessíveis</span>
            <Building2 className="h-4 w-4 text-accent" />
          </div>
          <p className="text-lg font-semibold text-foreground">
            {allowedHotels.length} {allowedHotels.length === 1 ? "hotel" : "hotéis"}
          </p>
        </Card>
      </div>

      <Card className="p-6 shadow-soft border-dashed">
        <h2 className="text-lg font-semibold mb-2">Próximas fases</h2>
        <p className="text-sm text-muted-foreground mb-4">
          A Fase 1 (base, autenticação e RBAC) está concluída. Os módulos abaixo serão entregues nas próximas fases conforme aprovação.
        </p>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li><strong className="text-foreground">Fase 1 (atual):</strong> Setup, Auth, RBAC, layout global ✓</li>
          <li><strong className="text-foreground">Fase 1.2:</strong> Workflow de Fechamento (DRE → Carta → Financeiro → Envio)</li>
          <li><strong className="text-foreground">Fase 1.3:</strong> Contas a Pagar (TOTVS + OMIE)</li>
          <li><strong className="text-foreground">Fase 2:</strong> Contas a Receber, Indicadores DRE, Metas GG</li>
          <li><strong className="text-foreground">Fase 3:</strong> RH & People Analytics, Controladoria, Integrações</li>
        </ul>
      </Card>
    </div>
  );
}
