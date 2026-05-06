import { useLocation, useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon, Bell, Settings, X, Hotel } from "lucide-react";
import { useFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { MONTHS_PT } from "@/lib/constants";
import { useEffect } from "react";
import { usePendingNotificationCount } from "@/hooks/useNotifications";
import { useGopManagers } from "@/hooks/useGopManagers";

export function AppHeader() {
  const { hotelId, gopId, month, year, dateFrom, dateTo, setHotelId, setGopId, setMonth, setYear, setDateFrom, setDateTo } = useFilters();
  const { allowedHotels, profile, signOut, isMaster, isGg } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isFinanceiro = pathname.startsWith("/financeiro");
  const isIndicadores = pathname.startsWith("/indicadores");
  const { data: pendingCount = 0 } = usePendingNotificationCount();
  const { data: gopManagers = [] } = useGopManagers();
  const selectedGop = gopManagers.find((g) => g.user_id === gopId);
  const gopHotelIds = selectedGop ? new Set(selectedGop.hotel_ids) : null;
  const visibleHotels = gopHotelIds
    ? allowedHotels.filter((h) => gopHotelIds.has(h.id))
    : allowedHotels;

  // Se hotel atual não pertence à carteira do GOP, limpar
  useEffect(() => {
    if (gopHotelIds && hotelId && !gopHotelIds.has(hotelId)) {
      setHotelId(null);
    }
  }, [gopId, gopHotelIds, hotelId, setHotelId]);

  // Garante que o hotel selecionado é permitido (ou null = todos quando master)
  useEffect(() => {
    if (hotelId && !allowedHotels.find((h) => h.id === hotelId)) {
      setHotelId(allowedHotels[0]?.id ?? null);
    }
    if (!hotelId && !isMaster && allowedHotels.length === 1) {
      setHotelId(allowedHotels[0].id);
    }
  }, [allowedHotels, hotelId, isMaster, setHotelId]);

  // GG: forçar sempre o único hotel permitido
  useEffect(() => {
    if (isGg && allowedHotels.length === 1 && hotelId !== allowedHotels[0].id) {
      setHotelId(allowedHotels[0].id);
    }
  }, [isGg, allowedHotels, hotelId, setHotelId]);

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  return (
    <header className="h-16 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-30">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hidden md:inline">
          Filtros
        </span>

        {isGg ? (
          <div className="h-9 px-3 flex items-center gap-2 rounded-md border border-input bg-muted/50 text-sm font-medium min-w-[180px]">
            <Hotel className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{allowedHotels[0]?.name ?? "Hotel"}</span>
          </div>
        ) : (
          <Select
            value={hotelId ?? "__all__"}
            onValueChange={(v) => setHotelId(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-[220px] h-9">
              <SelectValue placeholder="Hotel" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {isMaster && (
                <SelectItem value="__all__">
                  {selectedGop ? `Todos da carteira (${visibleHotels.length})` : "Todos os hotéis"}
                </SelectItem>
              )}
              {visibleHotels.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isIndicadores && !isGg && gopManagers.length > 0 && (
          <Select
            value={gopId ?? "__all__"}
            onValueChange={(v) => setGopId(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Gerente de Operações" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all__">Todos os GOPs</SelectItem>
              {gopManagers.map((g) => (
                <SelectItem key={g.user_id} value={g.user_id}>
                  {g.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isFinanceiro ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                title="Limpar datas"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {MONTHS_PT.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[100px] h-9">
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 relative"
          onClick={() => navigate("/configuracoes/notificacoes")}
          title="Notificações pendentes"
        >
          <Bell className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center leading-none">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <UserIcon className="h-4 w-4" />
            </div>
            <span className="hidden md:inline text-sm font-medium">
              {profile?.display_name ?? profile?.email}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-popover">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-0.5">
              <p className="text-sm font-medium">{profile?.display_name ?? "Usuário"}</p>
              <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/perfil")}>
            <Settings className="mr-2 h-4 w-4" />
            Meu perfil
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}