import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBankStatement } from "@/lib/conciliacaoParsers";

it("extrato real mantém 444 movimentos e captura os saldos separadamente", async () => {
  const bytes = readFileSync("src/test/fixtures/extrato_arcoverde_set2026.xlsx");
  const file = new File([bytes], "extrato.xlsx");
  const parsed = await parseBankStatement(file, [], "h1");
  expect(parsed.rows).toHaveLength(444);
  expect(parsed.balances.find(b => b.balance_date === "2026-08-31")?.real_balance).toBe(4806.48);
  expect(parsed.balances.find(b => b.balance_date === "2026-09-01")?.real_balance).toBe(4666.6);
  expect(parsed.rows.some(r => r.description.includes("SALDO"))).toBe(false);
});