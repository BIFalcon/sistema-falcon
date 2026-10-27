import { describe, it, expect } from "vitest";
import { buildConsolidatedRows, canViewRhConsolidated, consolidatedTotal, costPerRnExtremes, defaultEvolutionHotels } from "@/lib/rhConsolidated";

const raw = (id: string, cost: number | null, hc: number, rn: number | null, ot: number | null = null) => ({
  hotel_id: id, hotel_name: id, brand: null, total_cost: cost, headcount: hc, overtime_earnings: ot, roomnights: rn,
  departments: [{ department: "Governança", total_cost: cost == null ? null : cost / 2, headcount: hc }],
});

describe("RH consolidado", () => {
  it("acesso: global vê, GOP com mais de um hotel vê, GG e hotel único não", () => {
    expect(canViewRhConsolidated(["rh"], 1)).toBe(true);
    expect(canViewRhConsolidated(["viewer"], 0)).toBe(true);
    expect(canViewRhConsolidated(["gop"], 9)).toBe(true);
    expect(canViewRhConsolidated(["gop"], 1)).toBe(false);
    expect(canViewRhConsolidated(["gg"], 3)).toBe(false);
  });
  it("ausente fica nulo, nunca zero", () => {
    const [r] = buildConsolidatedRows([raw("a", null, 10, null)]);
    expect(r.cost_per_employee).toBeNull();
    expect(r.cost_per_roomnight).toBeNull();
    expect(r.overtime_pct).toBeNull();
  });
  it("métricas por hotel e total recalculado sobre somas", () => {
    const rows = buildConsolidatedRows([raw("a", 100000, 50, 2000, 10000), raw("b", 50000, 25, 500, null)]);
    expect(rows[0].cost_per_employee).toBe(2000);
    expect(rows[0].cost_per_roomnight).toBe(50);
    expect(rows[0].overtime_pct).toBe(10);
    expect(rows[0].dept["Governança"].pct).toBe(50);
    const t = consolidatedTotal(rows);
    expect(t.total_cost).toBe(150000);
    expect(t.cost_per_roomnight).toBe(60);
    expect(costPerRnExtremes(rows)).toEqual({ min: "a", max: "b" });
  });
  it("evolução: padrão são os 3 de maior custo", () => {
    const rows = buildConsolidatedRows([raw("a", 1, 1, 1), raw("b", 4, 1, 1), raw("c", 3, 1, 1), raw("d", 2, 1, 1)]);
    expect(defaultEvolutionHotels(rows)).toEqual(["b", "c", "d"]);
  });
});
