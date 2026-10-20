import { describe, expect, it } from "vitest";
import { sortPayrollEntries, type PayrollSortKey } from "@/lib/payrollSort";

const rows = [
  { id: "b", employee_name: "Bruno", position: "Recepcionista", department: "Recepção", admission_date: "2026-01-01", base_salary: 10000, total_cost: 12000 },
  { id: "a", employee_name: "Álvaro", position: "Auxiliar", department: "Administração", admission_date: "2025-12-31", base_salary: 2000, total_cost: 3000 },
];

describe("payroll column sorting", () => {
  it.each<PayrollSortKey>(["overtime_earnings", "overtime_hours_earnings", "night_earnings", "reflex_earnings", "holiday_earnings"])("sorts detailed %s numerically", key => {
    const source = [{ ...rows[0], [key]: 100 }, { ...rows[1], [key]: 20 }];
    expect(sortPayrollEntries(source, { key, direction: "asc" }).map(row => row.id)).toEqual(["a", "b"]);
  });
  it.each<PayrollSortKey>(["employee_name", "position", "department", "admission_date", "base_salary", "total_cost"])("sorts %s in both directions without changing source rows", (key) => {
    expect(sortPayrollEntries(rows, { key, direction: "asc" }).map(row => row.id)).toEqual(["a", "b"]);
    expect(sortPayrollEntries(rows, { key, direction: "desc" }).map(row => row.id)).toEqual(["b", "a"]);
    expect(rows.map(row => row.id)).toEqual(["b", "a"]);
  });
  it("preserves the original order until a header is selected", () => {
    expect(sortPayrollEntries(rows, null).map(row => row.id)).toEqual(["b", "a"]);
  });
  it("keeps missing values last in either direction", () => {
    const entries = [...rows, { ...rows[0], id: "missing", base_salary: null }];
    for (const direction of ["asc", "desc"] as const) {
      expect(sortPayrollEntries(entries, { key: "base_salary", direction }).at(-1)?.id).toBe("missing");
    }
  });
});