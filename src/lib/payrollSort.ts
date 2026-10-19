export type PayrollSortKey = "employee_name" | "position" | "department" | "admission_date" | "base_salary" | "total_cost";
export interface PayrollSort { key: PayrollSortKey; direction: "asc" | "desc" }
type SortableEntry = Record<PayrollSortKey, string | number | null>;

export function sortPayrollEntries<T extends SortableEntry>(entries: readonly T[], sort: PayrollSort | null): T[] {
  if (!sort) return [...entries];
  const { key, direction } = sort;
  return [...entries].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    // Missing values remain last in either direction.
    if (left == null || left === "") return right == null || right === "" ? 0 : 1;
    if (right == null || right === "") return -1;
    const comparison = key === "base_salary" || key === "total_cost"
      ? Number(left) - Number(right)
      : String(left).localeCompare(String(right), "pt-BR", { sensitivity: "base" });
    return direction === "asc" ? comparison : -comparison;
  });
}