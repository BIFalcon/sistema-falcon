import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { classifyFrancesinha, parseFrancesinhaSheets } from "@/lib/francesinha";
import { parseBankStatement } from "@/lib/conciliacaoParsers";

const sheets = (p: string) => {
  const wb = XLSX.read(readFileSync(p), { type: "buffer", cellDates: true });
  return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null, raw: true }) as unknown[][]]));
};

describe("francesinha (Arcoverde, set/2026)", () => {
  const rows = parseFrancesinhaSheets(sheets("src/test/fixtures/francesinha_sample.xlsx"), "ibis-arcoverde");
  const count = (a: string) => rows.filter((r) => r.acao === a).length;
  it("lê só a movimentação detalhada das 10 abas", () => expect(rows).toHaveLength(23));
  it("classifica as operações", () => {
    expect(count("liquidacao")).toBe(4);
    expect(count("baixa")).toBe(9);
    expect(count("entrada")).toBe(4);
    expect(count("ajuste")).toBe(6); // 2 juros + 1 tarifa de cobrança + 3 manutenção de título vencido
  });
  it("juros herda pagador/seu número do boleto pelo nosso número", () => {
    const j = rows.find((r) => r.descricao_operacao === "juros" && r.nosso_numero === "000001946")!;
    expect(j.seu_numero).toBe("4074");
    expect(j.pagador?.trim()).toBe("PAYTRACK");
    expect(j.data_movimento).toBe("2026-09-03");
  });
  it("liquidação traz seu número, vencimento e valor para a baixa", () => {
    expect(rows.find((r) => r.acao === "liquidacao" && r.seu_numero === "4045")).toMatchObject({ vencimento: "2026-08-17", valor_inicial: 257.25, valor_final: 261.18 });
  });
  it("mapeamento das operações", () => {
    expect(classifyFrancesinha("liquidação")).toBe("liquidacao");
    expect(classifyFrancesinha("tarifa de manutenção de título vencido")).toBe("ajuste");
  });
});

describe("extrato Arcoverde set/2026 — filtro da aba Dinheiro", () => {
  it("só depósitos e boleto com CNPJ do hotel; PIX continua completo", async () => {
    const buf = readFileSync("src/test/fixtures/extrato_arcoverde_set2026.xlsx");
    const file = new File([buf], "extrato.xlsx");
    const full = await parseBankStatement(file, [], "ibis-arcoverde");
    const cash = await parseBankStatement(file, [], "ibis-arcoverde", { kind: "dinheiro", hotelCnpj: "60.498.259/0001-36" });
    expect(full.rows.length).toBeGreaterThan(400);
    expect(cash.rows.length + cash.filtered).toBe(full.rows.length);
    expect(cash.rows.every((r) => !/PIX/.test(r.description))).toBe(true);
    expect(cash.rows.some((r) => r.description === "BOLETO PAGO" && r.amount === -1.5)).toBe(true);
    console.log("DINHEIRO", full.rows.length, cash.rows.map((r) => `${r.line_date} ${r.description} ${r.amount}`).join(" | "));
  });
});
