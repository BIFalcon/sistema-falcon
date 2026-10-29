import type { AppRole } from "@/lib/constants";

export const AUTOMATIC_CARD_HOTELS = [
  "ibis-arcoverde", "ibis-budget-divinopolis", "ibis-budget-manhuacu", "ibis-budget-patos",
  "ibis-cuiaba", "ibis-juiz-de-fora", "ibis-serra-talhada", "ibis-styles-garanhuns",
  "ibis-styles-tres-rios", "ibis-caruaru",
] as const;

export const FINANCIAL_OVERVIEW_ROLES: AppRole[] = ["controladoria", "patronos", "gg", "viewer", "gop", "adm"];

export function financialOverviewReadonly(roles: AppRole[]) {
  return roles.some(r => ["gop", "adm", "gg", "viewer", "fernando"].includes(r));
}

export function effectiveFinancialHotels(allowed: string[], selected: string[], single: string | null, portfolio: string[] | null, singleOnly = false) {
  const scope = allowed.filter(id => !portfolio || portfolio.includes(id));
  const requested = singleOnly ? (single ? [single] : scope.slice(0, 1)) : selected.length ? selected : single ? [single] : scope;
  return [...new Set(requested.filter(id => scope.includes(id)))];
}

export interface FinancialPeriod { dateFrom: string; dateTo: string; specificDates: string[] }
export function inFinancialPeriod(date: string | null, period: FinancialPeriod) {
  if (!date) return !period.specificDates.length && !period.dateFrom && !period.dateTo;
  if (period.specificDates.length) return period.specificDates.includes(date.slice(0, 10));
  return (!period.dateFrom || date >= period.dateFrom) && (!period.dateTo || date.slice(0, 10) <= period.dateTo);
}

/** Mirrors financial_card_term_days: report text carries a numeric day count. */
export function cardTermDays(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(?:\d+\s*(?:dias?(?:\s+(?:úteis|útil|cada parcela))?)?|disponível em D\+\d+)$/i);
  if (!match) return null;
  const days = Number(value.match(/\d+/)?.[0]);
  return Number.isSafeInteger(days) && days <= 36500 ? days : null;
}

export function expectedCardDate(sale: string | null, source: string, term: string | null) {
  const days = source === "b2b" ? 31 : source === "rede" ? cardTermDays(term) : null;
  if (!sale || days == null) return null;
  const date = new Date(`${sale}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function agingBand(days: number): "lt7" | "d7_30" | "gt30" {
  return days < 7 ? "lt7" : days <= 30 ? "d7_30" : "gt30";
}

export interface FinancialOverviewRow {
  hotel_id: string; automatic_card: boolean;
  payable: number; overdue: number; overdue_lt7: number; overdue_d7_30: number; overdue_gt30: number;
  defaulting: number; defaulting_lt7: number; defaulting_d7_30: number; defaulting_gt30: number; defaulting_unknown: number;
  open_folio: number; folio_lt7: number; folio_d7_30: number; folio_gt30: number; folio_unknown: number;
  to_invoice: number; card_receivable: number; invalid_card_terms: number;
  bank_balance: number; paid_interest: number; anticipated: number; anticipation_charge: number;
}

export function sumFinancialRows(rows: FinancialOverviewRow[], field: keyof FinancialOverviewRow) {
  return rows.reduce((sum, row) => sum + (typeof row[field] === "boolean" || typeof row[field] === "string" ? 0 : Number(row[field] ?? 0)), 0);
}