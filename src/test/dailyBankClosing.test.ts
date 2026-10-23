import { describe, expect, it } from "vitest";
import { closingFinal, statementBalance } from "@/lib/dailyBankClosing";

describe("Fechamento diário", () => {
  it("desconta crédito não confirmado dos créditos totais somente uma vez", () => {
    expect(closingFinal(1000, 500, -200, 100)).toBe(1200);
  });
  it("reverte a pendência quando o crédito é confirmado", () => {
    expect(closingFinal(1000, 500, 0, 100)).toBe(1400);
  });
  it("não fabrica saldo inicial ausente", () => {
    expect(closingFinal(null, 500, -200, 100)).toBeNull();
  });
  it("lê saldo real do extrato sem criar recebimento", () => {
    expect(statementBalance("2026-09-01", "SALDO TOTAL DISPONÍVEL DIA", 4666.6)).toEqual({ balance_date: "2026-09-01", initial_balance: null, real_balance: 4666.6 });
    expect(statementBalance("2026-08-31", "SALDO ANTERIOR", 4806.48)?.real_balance).toBe(4806.48);
    expect(statementBalance("2026-09-01", "PIX RECEBIDO", 21)).toBeNull();
  });
});