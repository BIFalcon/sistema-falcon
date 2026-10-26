import { describe, expect, it } from "vitest";
import { canTransition, excludedSettlementIds, isSaleInScope, type SettlementItem } from "@/lib/settlementCutoff";

const item: SettlementItem = { source: "rede", entry_id: "receipt", item_date: "2026-09-10", original_date: "2026-08-31", label: "Visa", amount: 100, eligibility: "anterior", transition_id: null };
describe("corte por hotel e baixa de transição", () => {
  it("inclui vendas no dia do corte e depois, não as anteriores", () => {
    expect(isSaleInScope("2026-09-01", "2026-09-01")).toBe(true);
    expect(isSaleInScope("2026-08-31", "2026-09-01")).toBe(false);
  });
  it("cada hotel usa seu próprio início e nenhum início é presumido", () => {
    expect(isSaleInScope("2026-09-10", "2026-09-01")).toBe(true);
    expect(isSaleInScope("2026-09-10", "2026-09-15")).toBe(false);
    expect(isSaleInScope("2026-08-31", null)).toBe(true);
  });
  it("recebimento em setembro de venda de agosto vai à transição pela venda original", () => {
    expect(excludedSettlementIds([item], "2026-09-01").has("rede:receipt")).toBe(true);
    expect(canTransition(item, "2026-09-01")).toBe(true);
  });
  it("origem desconhecida exige transição explícita e não desaparece automaticamente", () => {
    const unknown = { ...item, eligibility: "sem_origem", original_date: null };
    expect(excludedSettlementIds([unknown], "2026-09-01").size).toBe(0);
    expect(canTransition(unknown, "2026-09-01")).toBe(true);
    expect(canTransition(unknown, null)).toBe(false);
  });
  it("vendas atuais e lotes mistos não podem ser tratados como transição", () => {
    expect(canTransition({ ...item, eligibility: "atual" }, "2026-09-01")).toBe(false);
  });
  it("transição registrada sai da fila e não pode ser repetida", () => {
    const done = { ...item, transition_id: "transition" };
    expect(canTransition(done, "2026-09-01")).toBe(false);
    expect(excludedSettlementIds([done], null).has("rede:receipt")).toBe(true);
  });
});