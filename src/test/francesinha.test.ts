import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { classifyFrancesinha, parseFrancesinhaSheets } from "@/lib/francesinha";
import { isCashBankLine } from "@/lib/conciliacaoParsers";

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
  it("só depósitos e boleto com CNPJ do hotel", () => {
    const g = Object.values(sheets("src/test/fixtures/extrato_arcoverde_set2026.xlsx"))[0];
    const hi = g.findIndex((r) => r?.[1] === "Lançamento");
    const kept = g.slice(hi + 1).filter((r) => r?.[1] && isCashBankLine(String(r[1]), r[3] as string, "60.498.259/0001-36"));
    const total = g.slice(hi + 1).filter((r) => r?.[1]).length;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(total);
    expect(kept.some((r) => String(r[1]).startsWith("BOLETO PAGO") && r[3] === "60.498.259/0001-36")).toBe(true);
    expect(kept.some((r) => /PIX/.test(String(r[1])))).toBe(false);
    console.log("DINHEIRO", total, kept.map((r) => `${r[0]} ${r[1]} ${r[4]}`).join(" | "));
  });
});
