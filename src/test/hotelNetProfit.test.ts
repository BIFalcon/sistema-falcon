import { describe, it, expect } from "vitest";
import { applyNetProfitOverride } from "@/lib/hotelNetProfit";
import type { DreLineNode } from "@/lib/dreAnalytics";

const node = (id: string, label: string, sep: number | null): DreLineNode => {
  const cur = Array(12).fill(null); cur[8] = sep;
  return { id, label, level: 1, children: [], series: { current: cur, budget: Array(12).fill(null), previous: Array(12).fill(null) } };
};

describe("lucro líquido por hotel", () => {
  it("Jaboatão: lucro = -(Aluguel Variável) e margem sobre Receita Bruta Total", () => {
    const flat = [
      node("a", "(-) Aluguel variável", -99053.16),
      node("b", "Lucro Líquido / Prejuízo do Exercício", 0),
      node("c", "RECEITA BRUTA TOTAL", 912925.14),
      node("d", "Margem Líquida", 0),
    ];
    applyNetProfitOverride(flat, "ibis-budget-recife");
    expect(flat[1].series.current[8]).toBeCloseTo(99053.16, 2);
    expect(flat[3].series.current[8]).toBeCloseTo(0.1085, 4);
  });
  it("demais hotéis ficam inalterados", () => {
    const flat = [node("a", "(-) Aluguel variável", 22274.35), node("b", "Lucro Líquido", -500)];
    applyNetProfitOverride(flat, "ibis-budget-petropolis");
    expect(flat[1].series.current[8]).toBe(-500);
  });
});
