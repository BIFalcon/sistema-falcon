import { calcMetrics, type RhEmployee } from "@/hooks/useRh";

export interface RhMonthlySnapshot {
  month: number;
  year: number;
  employees: RhEmployee[];
}

export function turnoverMonthlySeries(snapshots: RhMonthlySnapshot[], hotelId: string | null) {
  return snapshots.map(({ month, year, employees }) => {
    const rows = hotelId ? employees.filter((employee) => employee.hotel_id === hotelId) : employees;
    const metrics = calcMetrics(rows, month, year);
    return {
      name: `${String(month).padStart(2, "0")}/${year}`,
      turnover: rows.length ? metrics.pctRotatividade : null,
      admitted: rows.length ? metrics.admitidos : null,
      terminated: rows.length ? metrics.inativos : null,
      active: metrics.ativos,
    };
  });
}

export function departuresBySector(rows: RhEmployee[]) {
  const counts = new Map<string, number>();
  for (const employee of rows) {
    const name = employee.department?.trim() || employee.position?.trim() || "Não informado";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
}