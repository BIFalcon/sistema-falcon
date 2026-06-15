export const ROLE_LABELS: Record<string, string> = {
  processos: "Processos",
  fernando: "Fernando",
  controladoria: "Controladoria",
  patronos: "Patronos",
  gop: "Gerente de Operações",
  ri: "Relações com Investidores",
  financeiro: "Financeiro (descontinuado)",
  gg: "Gerente Geral",
  adm: "Administrativo do Hotel",
  rh: "RH & People",
  marketing: "Marketing",
  comercial: "Comercial",
  operacoes: "Operações",
  viewer: "Visualizador",
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
  | "patronos"
  | "gop"
  | "ri"
  | "financeiro"
  | "gg"
  | "adm"
  | "rh"
  | "marketing"
  | "comercial"
  | "operacoes"
  | "viewer";

export interface Hotel {
  id: string;
  name: string;
  brand: string;
  active: boolean;
  show_in_closing?: boolean;
}

// ====== Workflow de Fechamento ======

export type ClosingStatus =
  | "nao_iniciado"
  | "em_andamento"
  | "pendente"
  | "aprovado"
  | "devolvido"
  | "aguardando_comentarios"
  | "aguardando_controladoria"
  | "aguardando_gop"
  | "aguardando_fernando"
  | "aguardando_gg"
  | "nao_aplicavel"
  | "sem_distribuicao";

export type ClosingStage = "dre" | "carta" | "financeiro" | "envio";

export const STAGE_LABELS: Record<ClosingStage, string> = {
  dre: "DRE",
  carta: "Carta ao Investidor",
  financeiro: "Financeiro",
  envio: "Envio",
};

export const STATUS_LABELS: Record<ClosingStatus, string> = {
  nao_iniciado: "Não Iniciado",
  em_andamento: "Em Andamento",
  pendente: "Pendente",
  aprovado: "Aprovado",
  devolvido: "Devolvido",
  aguardando_comentarios: "Aguardando Comentários",
  aguardando_controladoria: "Aguardando Controladoria",
  aguardando_gop: "Aguardando GOP",
  aguardando_fernando: "Aguardando Fernando",
  aguardando_gg: "Aguardando GG",
  nao_aplicavel: "Não Aplicável",
  sem_distribuicao: "Não Houve Distribuição",
};

export type StatusTone = "neutral" | "progress" | "pending" | "approved" | "returned";

export const STATUS_TONE: Record<ClosingStatus, StatusTone> = {
  nao_iniciado: "neutral",
  em_andamento: "progress",
  pendente: "pending",
  aprovado: "approved",
  devolvido: "returned",
  aguardando_comentarios: "pending",
  aguardando_controladoria: "pending",
  aguardando_gop: "pending",
  aguardando_fernando: "pending",
  aguardando_gg: "pending",
  nao_aplicavel: "neutral",
  sem_distribuicao: "approved",
};

// Hotéis que pulam a Carta ao Investidor (exceção documentada).
export const HOTELS_WITHOUT_CARTA = ["ibis-budget-recife"] as const;

export function hotelSkipsCarta(hotelId: string | null | undefined): boolean {
  if (!hotelId) return false;
  return (HOTELS_WITHOUT_CARTA as readonly string[]).includes(hotelId);
}

// Quem aprova qual estágio do DRE
export const DRE_STAGE_APPROVER: Record<ClosingStatus, AppRole | null> = {
  // Apenas a controladoria pode avançar a etapa de comentários — GG/GOP só comentam.
  aguardando_comentarios: "controladoria",
  aguardando_controladoria: "controladoria",
  aguardando_gop: "gop",
  aguardando_fernando: "fernando",
  // demais não aplicáveis
  nao_iniciado: null,
  em_andamento: null,
  pendente: null,
  aprovado: null,
  devolvido: null,
  aguardando_gg: null,
  nao_aplicavel: null,
  sem_distribuicao: null,
};

// Sequência de avanço do DRE
export const DRE_NEXT_STATUS: Partial<Record<ClosingStatus, ClosingStatus>> = {
  nao_iniciado: "aguardando_controladoria",
  aguardando_comentarios: "aguardando_controladoria",
  aguardando_controladoria: "aguardando_gop",
  aguardando_gop: "aguardando_fernando",
  aguardando_fernando: "aprovado",
  devolvido: "aguardando_controladoria",
};

// Estágio anterior para devolução
export const DRE_PREV_STATUS: Partial<Record<ClosingStatus, ClosingStatus>> = {
  aguardando_controladoria: "aguardando_comentarios",
  aguardando_gop: "aguardando_controladoria",
  aguardando_fernando: "aguardando_gop",
  aprovado: "aguardando_fernando",
};

// ====== Workflow da Carta ao Investidor ======
// Fluxo: GG redige/edita -> GG aprova -> GOP revisa/aprova -> Fernando revisa/aprova -> aprovado
export const CARTA_NEXT_STATUS: Partial<Record<ClosingStatus, ClosingStatus>> = {
  nao_iniciado: "aguardando_gg",
  aguardando_gg: "aguardando_gop",
  aguardando_gop: "aguardando_fernando",
  aguardando_fernando: "aprovado",
  devolvido: "aguardando_gg",
};

export const CARTA_PREV_STATUS: Partial<Record<ClosingStatus, ClosingStatus>> = {
  aguardando_gop: "aguardando_gg",
  aguardando_fernando: "aguardando_gop",
  aprovado: "aguardando_fernando",
};

export const CARTA_STAGE_APPROVER: Record<ClosingStatus, AppRole | null> = {
  aguardando_gg: "gg",
  aguardando_gop: "gop",
  aguardando_fernando: "fernando",
  nao_iniciado: null,
  em_andamento: null,
  pendente: null,
  aprovado: null,
  devolvido: null,
  aguardando_comentarios: null,
  aguardando_controladoria: null,
  nao_aplicavel: null,
  sem_distribuicao: null,
};

// SLA por estágio (horas)
export const SLA_HOURS = {
  dre: 48,
  carta: 24,
} as const;

// Formatação BR
export function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

// Sanitização de nomes de arquivo
export function sanitizeFileName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_\-.]+/g, "_")
    .replace(/_+/g, "_");
}