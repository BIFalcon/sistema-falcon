import { describe, expect, it } from "vitest";
import { batchProgress } from "@/lib/settlementBatch";
describe("Lote de cartão: 100% das vendas", () => {
  it("não apresenta lote vazio como 100%", () => expect(batchProgress({ total: 0, reconciled: 0 })).toBe(0));
  it("uma venda pendente impede 100%", () => expect(batchProgress({ total: 1000, reconciled: 999 })).toBe(99));
  it("todas conciliadas representam 100%", () => expect(batchProgress({ total: 7, reconciled: 7 })).toBe(100));
});