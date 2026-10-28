import type { AppRole } from "@/lib/constants";

export const DRE_INDICATOR_ROLES: AppRole[] = ["gop", "gg", "controladoria", "patronos", "operacoes", "viewer", "rh", "adm", "novos_negocios"];

export function isNovosNegociosOnly(roles: AppRole[]): boolean {
  return roles.length > 0 && roles.every(role => role === "novos_negocios");
}

export function canAccessNovosNegociosPath(path: string): boolean {
  return ["/fechamento/dre", "/indicadores", "/perfil"].includes(path);
}

export function isDreSummaryOnly(roles: AppRole[], isMaster: boolean): boolean {
  return !isMaster && roles.includes("adm") && !roles.some((role) => DRE_INDICATOR_ROLES.includes(role) && role !== "adm");
}

export function resolveDreTab(requested: string | null, summaryOnly: boolean): string {
  return !summaryOnly && (requested === "comparativo" || requested === "historico") ? requested : "resumo";
}

export function scopeDreHotelIds(selected: string[], hotelId: string | null, allowed: string[], summaryOnly: boolean): string[] {
  const permitted = new Set(allowed);
  const candidates = selected.length > 0 ? selected : hotelId ? [hotelId] : [];
  const scoped = [...new Set(candidates)].filter((id) => permitted.has(id));
  if (!summaryOnly) return scoped;
  return scoped.length > 0 ? scoped.slice(0, 1) : allowed.slice(0, 1);
}
/** GOP sees every network hotel, but only inside Indicadores DRE. */
export function usesNetworkDreHotels(roles: AppRole[], isMaster: boolean): boolean {
  return !isMaster && roles.includes("gop") && !isDreSummaryOnly(roles, isMaster);
}
