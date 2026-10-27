/** Visão consolidada de folha entre hotéis — apenas agregados por hotel. */
export interface RhConsolidatedHotelRaw {
  hotel_id: string;
  hotel_name: string;
  brand: string | null;
  total_cost: number | null;
  headcount: number | null;
  overtime_earnings: number | null;
  roomnights: number | null;
  departments: { department: string; total_cost: number | null; headcount: number | null }[];
}

export interface RhConsolidatedRow extends RhConsolidatedHotelRaw {
  cost_per_employee: number | null;
  cost_per_roomnight: number | null;
  overtime_pct: number | null;
  dept: Record<string, { value: number | null; pct: number | null }>;
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ratio = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

/** Hotéis do GOP/demais: precisa de mais de um hotel; GG nunca vê; acesso global sempre vê. */
export function canViewRhConsolidated(roles: readonly string[], hotelCount: number): boolean {
  if (["processos", "rh", "fernando", "viewer"].some((r) => roles.includes(r))) return true;
  return roles.includes("gop") && hotelCount > 1;
}

export function buildConsolidatedRows(raw: RhConsolidatedHotelRaw[]): RhConsolidatedRow[] {
  return raw.map((r) => {
    const total = num(r.total_cost);
    const hc = num(r.headcount);
    const ot = num(r.overtime_earnings);
    const rn = num(r.roomnights);
    const dept: RhConsolidatedRow["dept"] = {};
    for (const d of r.departments ?? []) {
      const v = num(d.total_cost);
      dept[d.department] = { value: v, pct: ratio(v, total) == null ? null : ratio(v, total)! * 100 };
    }
    return {
      ...r, total_cost: total, headcount: hc, overtime_earnings: ot, roomnights: rn,
      cost_per_employee: ratio(total, hc),
      cost_per_roomnight: ratio(total, rn),
      overtime_pct: ratio(ot, total) == null ? null : ratio(ot, total)! * 100,
      dept,
    };
  });
}

const sumNullable = (vals: (number | null)[]) => (vals.some((v) => v != null) ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : null);

/** Linha de total: razões recalculadas sobre as somas (nunca média de razões). */
export function consolidatedTotal(rows: RhConsolidatedRow[]) {
  const total = sumNullable(rows.map((r) => r.total_cost));
  const hc = sumNullable(rows.map((r) => r.headcount));
  const ot = sumNullable(rows.map((r) => r.overtime_earnings));
  const withRn = rows.filter((r) => r.roomnights != null && r.total_cost != null);
  const rn = sumNullable(withRn.map((r) => r.roomnights));
  const rnCost = sumNullable(withRn.map((r) => r.total_cost));
  const depts = departmentNames(rows);
  const dept: RhConsolidatedRow["dept"] = {};
  for (const d of depts) {
    const v = sumNullable(rows.map((r) => r.dept[d]?.value ?? null));
    dept[d] = { value: v, pct: ratio(v, total) == null ? null : ratio(v, total)! * 100 };
  }
  return {
    total_cost: total, headcount: hc, overtime_earnings: ot, roomnights: sumNullable(rows.map((r) => r.roomnights)),
    cost_per_employee: ratio(total, hc), cost_per_roomnight: ratio(rnCost, rn),
    overtime_pct: ratio(ot, total) == null ? null : ratio(ot, total)! * 100, dept,
  };
}

export function departmentNames(rows: RhConsolidatedRow[]): string[] {
  const totals = new Map<string, number>();
  for (const r of rows) for (const [d, v] of Object.entries(r.dept)) totals.set(d, (totals.get(d) ?? 0) + (v.value ?? 0));
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

/** Hotéis com maior e menor custo por roomnight (ignora ausentes). */
export function costPerRnExtremes(rows: RhConsolidatedRow[]): { max: string | null; min: string | null } {
  const valid = rows.filter((r) => r.cost_per_roomnight != null);
  if (valid.length < 2) return { max: null, min: null };
  const sorted = [...valid].sort((a, b) => a.cost_per_roomnight! - b.cost_per_roomnight!);
  return { min: sorted[0].hotel_id, max: sorted[sorted.length - 1].hotel_id };
}

/** Padrão do gráfico de evolução: os 3 hotéis de maior custo. */
export function defaultEvolutionHotels(rows: RhConsolidatedRow[], n = 3): string[] {
  return [...rows].filter((r) => r.total_cost != null).sort((a, b) => b.total_cost! - a.total_cost!).slice(0, n).map((r) => r.hotel_id);
}
