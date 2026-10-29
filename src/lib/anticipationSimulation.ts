import { differenceInCalendarDays, parseISO } from 'date-fns';
import { isWithinPeriod, type Period } from './apPeriodFilter';

export interface AnticipationSimulation {
  id: string; hotel_id: string; data_antecipacao: string | null;
  anticipated_amount: number; valor_descontado: number | null; valor_liquido: number | null;
  status: string | null; created_by: string | null;
  rede_reference: unknown;
}
export function canSimulateAnticipation(master: boolean, roles: string[]) {
  return !roles.includes('fernando') && (master || roles.includes('patronos') || roles.includes('controladoria'));
}
export function validSimulation(gross: number, discount: number, net: number) {
  return [gross, discount, net].every(Number.isFinite) && gross > 0 && discount >= 0 && discount < gross && net > 0 && net <= gross;
}
export function simulatedNet(rows: AnticipationSimulation[], from: string, to: string, dates: string[] = [], period: Period = 'all') {
  return rows.filter(r => {
    const d = r.data_antecipacao;
    return r.status === 'simulada' && !!d && isWithinPeriod(d, period) && (dates.length ? dates.includes(d) : (!from || d >= from) && (!to || d <= to));
  }).reduce((s, r) => s + Number(r.valor_liquido ?? 0), 0);
}
export const confirmationMatches = (simulated: number, actual: number) => Math.abs(Math.round(simulated * 100) - Math.round(actual * 100)) <= 100;
export const countsAsFinancialCharge = (status: string | null) => status === null || status === 'confirmada';
export function unconfirmedDays(row: AnticipationSimulation, today = new Date()) {
  return row.status === 'simulada' && row.data_antecipacao ? Math.max(0, differenceInCalendarDays(today, parseISO(row.data_antecipacao))) : 0;
}
export interface AnticipatedPayment { data_recebimento: string | null; data_original_vencimento: string | null; valor_liquido_parcela: number | null }
export function anticipatedDaily(payments: AnticipatedPayment[]) {
  const m = new Map<string, number>();
  for (const p of payments) {
    if (p.data_recebimento && p.data_original_vencimento && p.data_recebimento < p.data_original_vencimento && p.valor_liquido_parcela != null) {
      m.set(p.data_recebimento, (m.get(p.data_recebimento) ?? 0) + Number(p.valor_liquido_parcela));
    }
  }
  return [...m].map(([date, net]) => ({ date, net: Math.round(net * 100) / 100 })).sort((a,b) => b.date.localeCompare(a.date));
}