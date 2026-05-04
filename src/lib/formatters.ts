/**
 * Utilitários de formatação compartilhados entre módulos financeiros.
 * Centraliza as funções fmtBRL / fmtDate / fmtDateTime que antes
 * eram redefinidas em cada página.
 */

export function fmtBRL(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

/** Converte "YYYY-MM-DD" para "DD/MM/YYYY". */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** Converte uma string ISO para data+hora no padrão BR. */
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
