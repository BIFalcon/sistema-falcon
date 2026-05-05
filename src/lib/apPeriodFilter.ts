/**
 * Lógica de filtro por período de vencimento.
 * Extraída da ContasPagarPage para facilitar testes unitários isolados.
 */

export type Period =
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "next_month"
  | "overdue"
  | "all";

export type StatusFilter =
  | "all"
  | "issues"
  | "payment_pendente"
  | "payment_inserido"
  | "payment_agendado"
  | "payment_pago";

/**
 * Verifica se uma data de vencimento se enquadra no período selecionado.
 * A comparação é feita em dias inteiros (sem hora) para evitar bugs de fuso.
 */
export function isWithinPeriod(due: string | null, period: Period): boolean {
  if (period === "all") return true;
  if (!due) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const diffDays = Math.floor((d.getTime() - today.getTime()) / 86_400_000);

  switch (period) {
    case "overdue":
      return diffDays < 0;
    case "today":
      return diffDays === 0;
    case "tomorrow":
      return diffDays === 1;
    case "this_week": {
      const endOfWeek = 6 - today.getDay();
      return diffDays >= 0 && diffDays <= endOfWeek;
    }
    case "next_week": {
      const startNext = 7 - today.getDay();
      return diffDays >= startNext && diffDays <= startNext + 6;
    }
    case "next_month": {
      const nextMonth = (today.getMonth() + 1) % 12;
      return d.getMonth() === nextMonth && d.getFullYear() >= today.getFullYear();
    }
  }
}
