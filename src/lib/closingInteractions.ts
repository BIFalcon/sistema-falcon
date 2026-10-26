export interface ClosingInteraction {
  hotel_id: string; hotel: string; is_historical: boolean;
  t_prev: string | null; t_gg: string | null; t_gop: string | null; t_fer: string | null;
  tipo_gop: string | null; tipo_fer: string | null;
  h_prev_gg: number | null; h_gg_gop: number | null; h_gop_fer: number | null; h_total: number | null;
  ultimo_marco: string | null; h_desde_ultimo: number | null;
  gg_antes_previa: boolean; gg_depois_gop: boolean;
}
export type TimeUnit = 'business' | 'calendar';
export type IntervalKey = 'h_prev_gg' | 'h_gg_gop' | 'h_gop_fer' | 'h_total';
export const INTERVALS: { key: IntervalKey; label: string; start: keyof ClosingInteraction; end: keyof ClosingInteraction }[] = [
  { key: 'h_prev_gg', label: 'Prévia→GG', start: 't_prev', end: 't_gg' },
  { key: 'h_gg_gop', label: 'GG→GOP', start: 't_gg', end: 't_gop' },
  { key: 'h_gop_fer', label: 'GOP→Fernando', start: 't_gop', end: 't_fer' },
  { key: 'h_total', label: 'Total', start: 't_prev', end: 't_fer' },
];
export function calendarDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms > 0 ? ms / 86400000 : null;
}
export function intervalValue(row: ClosingInteraction, key: IntervalKey, unit: TimeUnit): number | null {
  const interval = INTERVALS.find(i => i.key === key);
  if (!interval) return null;
  const start = row[interval.start] as string | null;
  const end = row[interval.end] as string | null;
  const days = calendarDays(start, end);
  return days == null ? null : unit === 'calendar' ? days : row[key];
}
export function summary(rows: ClosingInteraction[], key: IntervalKey, unit: TimeUnit) {
  const values = rows.filter(r => r.t_prev).map(r => intervalValue(r, key, unit)).filter((v): v is number => v != null).sort((a,b) => a-b);
  const n = values.length;
  return { n, mean: n ? values.reduce((a,b) => a+b,0)/n : null, median: n ? ((values[Math.floor((n-1)/2)] ?? 0)+(values[Math.floor(n/2)] ?? 0))/2 : null };
}
export function formatDuration(value: number | null, unit: TimeUnit): string {
  if (value == null) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 'calendar' ? 1 : 1, minimumFractionDigits: unit === 'calendar' ? 1 : 0 })}${unit === 'business' ? 'h' : 'd'}`;
}
export function formatInteractionDate(value: string | null, full = false): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', ...(full ? {year:'numeric'} as const : {}), hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}${full ? `/${get('year')}` : ''} ${get('hour')}:${get('minute')}`;
}
export function intervalReason(row: ClosingInteraction, key: IntervalKey): string {
  const i = INTERVALS.find(i => i.key === key);
  if (!i) return 'Sem registro';
  if (!row[i.start] || !row[i.end]) return 'Uma ou ambas as primeiras interações ainda não têm registro.';
  return 'A interação final não é posterior à inicial; este intervalo não é calculado.';
}
export function recentPeriods(month: number, year: number) {
  return [2,1,0].map(offset => { const d = new Date(year,month-1-offset,1); return {month:d.getMonth()+1,year:d.getFullYear()}; });
}
export function quartile(value: number | null, values: number[]): number {
  if (value == null || !values.length) return 0;
  const sorted = [...values].sort((a,b)=>a-b);
  return [0.25,0.5,0.75].filter(q=>value>(sorted[Math.floor((sorted.length-1)*q)] ?? value)).length;
}