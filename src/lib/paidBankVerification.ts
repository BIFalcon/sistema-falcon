export interface PaidBankInput {
  id: string; hotel_id: string | null; paid_date: string | null; amount: number | null;
}
export interface VerificationBankRow { hotel_id: string; line_date: string | null; amount: number }
export interface VerifiedBoleto { ar_id: string; hotel_id: string; credit_date: string }

export function missingBankPayments(entries: PaidBankInput[], bank: VerificationBankRow[], boletos: VerifiedBoleto[]) {
  const missing = new Set<string>();
  const verified = new Set(boletos.map(b => `${b.ar_id}|${b.hotel_id}|${b.credit_date}`));
  const hotels = new Map<string, { min: string; max: string; credits: Set<string> }>();
  for (const b of bank) {
    if (!b.hotel_id || !b.line_date) continue;
    const h = hotels.get(b.hotel_id) ?? { min: b.line_date, max: b.line_date, credits: new Set<string>() };
    h.min = b.line_date < h.min ? b.line_date : h.min;
    h.max = b.line_date > h.max ? b.line_date : h.max;
    if (Number(b.amount) > 0) h.credits.add(`${b.line_date}|${Number(b.amount).toFixed(2)}`);
    hotels.set(b.hotel_id, h);
  }
  for (const e of entries) {
    if (!e.hotel_id || !e.paid_date || e.amount == null) continue;
    const h = hotels.get(e.hotel_id);
    if (!h || e.paid_date < h.min || e.paid_date > h.max) continue;
    if (verified.has(`${e.id}|${e.hotel_id}|${e.paid_date}`)) continue;
    if (!h.credits.has(`${e.paid_date}|${Math.abs(Number(e.amount)).toFixed(2)}`)) missing.add(e.id);
  }
  return missing;
}