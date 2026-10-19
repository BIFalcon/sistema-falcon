import type { AppRole } from "@/lib/constants";

export const RH_VIEW_ROLES: AppRole[] = ["processos", "fernando", "rh", "viewer", "gop", "gg"];
export const canUploadRh = (roles: readonly string[]) => roles.includes("processos") || roles.includes("rh");
export const canViewRh = (roles: readonly string[]) => roles.some((role) => RH_VIEW_ROLES.includes(role as AppRole));