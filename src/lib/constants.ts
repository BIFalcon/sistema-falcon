export const ROLE_LABELS: Record<string, string> = {
  processos: "Processos",
  fernando: "Fernando",
  controladoria: "Controladoria",
  gop: "Gerente de Operações",
  ri: "Relações com Investidores",
  financeiro: "Financeiro",
  gg: "Gerente Geral",
};

export const MASTER_ROLES = ["processos", "fernando"] as const;

export const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type AppRole =
  | "processos"
  | "fernando"
  | "controladoria"
  | "gop"
  | "ri"
  | "financeiro"
  | "gg";

export interface Hotel {
  id: string;
  name: string;
  brand: string;
  active: boolean;
}