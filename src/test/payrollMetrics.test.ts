import { describe, expect, it } from "vitest";
import { payrollCostPerRoomnight, payrollDepartmentPercentage, payrollMonthlySeries } from "@/lib/payrollMetrics";

describe("net payroll metrics", () => {
  it("uses liquid payroll for the Roomnight cost", () => {
    expect(payrollCostPerRoomnight(464801.28, 1000)).toBeCloseTo(464.80128);
  });
  it("uses liquid department and liquid total for the share", () => {
    expect(payrollDepartmentPercentage(200, 800)).toBe(25);
  });
  it("preserves missing legacy net data instead of replacing it with zero", () => {
    expect(payrollMonthlySeries([{ reference_month: 8, total_cost: null }], [])[7].total).toBeNull();
    expect(payrollCostPerRoomnight(null, 1000)).toBeNull();
    expect(payrollDepartmentPercentage(null, null)).toBeNull();
  });
  it("keeps overtime in its own monthly series", () => {
    const series = payrollMonthlySeries([{ reference_month: 9, total_cost: 464801.28 }], [{ reference_month: 9, total_overtime_earnings: 21654.67 }]);
    expect(series[8]).toEqual({ reference_month: 9, total: 464801.28, overtime: 21654.67 });
    expect(series[7].overtime).toBeNull();
    expect(series[9].total).toBeNull();
  });
  it("distinguishes real zero overtime from missing data", () => {
    expect(payrollMonthlySeries([], [{ reference_month: 9, total_overtime_earnings: 0 }])[8].overtime).toBe(0);
  });
});