export interface DailyClosingRow {
  day: string;
  initial: number | null;
  credits: number;
  received: number;
  paid: number;
  pending: number;
  final: number | null;
  real: number | null;
  difference: number | null;
}

export function closingFinal(initial: number | null, credits: number, pending: number, paid: number) {
  return initial === null ? null : Math.round((initial + credits + pending - paid) * 100) / 100;
}

export interface StatementBalance { balance_date: string; initial_balance: number | null; real_balance: number | null }

/** Summary rows are snapshots, never bank movements. Previous balance is dated on its own day. */
export function statementBalance(date: string, description: string, value: unknown): StatementBalance | null {
  if (!date || value === null || value === undefined || value === "") return null;
  const label = description.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (!label.includes("SALDO ANTERIOR") && !label.includes("SALDO TOTAL DISPONIVEL DIA")) return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return { balance_date: date, initial_balance: null, real_balance: amount };
}