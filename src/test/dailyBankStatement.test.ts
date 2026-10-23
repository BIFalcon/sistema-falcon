import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBankStatement } from "@/lib/conciliacaoParsers";
import { isPixBankLine } from "@/lib/pixBankFilter";
import { isB2BBankLine } from "@/lib/b2bBaixa";

it("extrato real mantém 444 movimentos e captura os saldos separadamente", async () => {
  const bytes = readFileSync("src/test/fixtures/extrato_arcoverde_set2026.xlsx");
  const file = new File([bytes], "extrato.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => Uint8Array.from(bytes).buffer });
  const parsed = await parseBankStatement(file, [], "h1");
  expect(parsed.rows).toHaveLength(444);
  expect(parsed.balances.find(b => b.balance_date === "2026-08-31")?.real_balance).toBe(4806.48);
  expect(parsed.balances.find(b => b.balance_date === "2026-09-01")?.real_balance).toBe(4666.6);
  expect(parsed.rows.some(r => r.description.includes("SALDO"))).toBe(false);
  expect(parsed.rows.filter(r => isB2BBankLine(r.description))).toHaveLength(9);
  expect(parsed.rows.filter(r => r.amount > 0 && /RECEBIDOS|RECEBIMENTOS/i.test(r.description) && isPixBankLine(r.description))).toHaveLength(8);
  expect(parsed.rows.filter(r => /BOLETOS? RECEBIDOS/i.test(r.description)).every(r => !isPixBankLine(r.description))).toBe(true);
});