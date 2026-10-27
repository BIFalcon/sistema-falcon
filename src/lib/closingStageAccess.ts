import type { AppRole, ClosingStatus } from "@/lib/constants";

/** Espelha closing_stage_can_act no servidor. */
export function canActOnStage(
  stage: "dre" | "carta",
  status: ClosingStatus,
  roles: AppRole[],
  isFernandoCEO = false,
): boolean {
  const has = (r: AppRole) => roles.includes(r);
  if (has("fernando") || isFernandoCEO) return status === "aguardando_fernando";
  if (has("processos")) return true;
  const ctrl = has("controladoria") || has("patronos");
  if (stage === "dre") {
    if (status === "aguardando_comentarios") return ctrl || has("gg") || has("gop");
    if (status === "aguardando_controladoria") return ctrl;
    if (status === "aguardando_gop") return has("gop");
    return false;
  }
  if (status === "aguardando_gg") return has("gg");
  if (status === "aguardando_gop") return has("gop");
  return false;
}

export const STAGE_OWNER_LABEL: Partial<Record<ClosingStatus, string>> = {
  aguardando_comentarios: "Controladoria",
  aguardando_controladoria: "Controladoria",
  aguardando_gop: "GOP",
  aguardando_fernando: "Fernando",
  aguardando_gg: "GG",
};
