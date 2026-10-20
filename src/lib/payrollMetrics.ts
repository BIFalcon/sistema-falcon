export interface PayrollHistoryPoint {
  reference_month: number;
  total_cost: number | null;
}

export interface PayrollOvertimePoint {
  reference_month: number;
  total_overtime_earnings: number | null;
}

export function payrollMonthlySeries(history: readonly PayrollHistoryPoint[], overtime: readonly PayrollOvertimePoint[]) {
  return Array.from({ length: 12 }, (_, index) => ({
    reference_month: index + 1,
    total: history.find(row => row.reference_month === index + 1)?.total_cost ?? null,
    overtime: overtime.find(row => row.reference_month === index + 1)?.total_overtime_earnings ?? null,
  }));
}

export function payrollCostPerRoomnight(netTotal: number | null | undefined, roomnights: number | null | undefined) {
  return netTotal != null && roomnights != null && roomnights > 0 ? netTotal / roomnights : null;
}

export function payrollDepartmentPercentage(netDepartment: number | null, netTotal: number | null) {
  return netDepartment != null && netTotal != null && netTotal !== 0 ? netDepartment / netTotal * 100 : null;
}