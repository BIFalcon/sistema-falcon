import { describe, it, expect } from "vitest";
import { splitRedeReimport } from "@/lib/redeReimport";
import type { AcquirerRow } from "@/lib/conciliacaoParsers";

const row = (over: Partial<AcquirerRow>): AcquirerRow => ({
  entry_key: "k-new", hotel_id: "h1", establishment_raw: "", sale_date: "2026-10-01",
  amount: 100, bandeira: "Visa", modalidade: "Crédito", categoria: "Visa Credito",
  status: "Aprovada", cnpj: "", source: "rede", nsu: "123", ...over,
});
const original = { id: "orig", entry_key: "k-orig", nsu: "123", bandeira: "Visa", amount: 100, created_at: "2026-10-02" };

describe("splitRedeReimport", () => {
  it("reimportação reconhece venda existente sem NSU e preserva sua identidade para completar os dados", () => {
    const saved = { ...original, nsu: null, amount: 237.93 };
    const parsed = row({ entry_key: "k-orig", nsu: "181235762", bandeira: "Elo", modalidade: "Débito", amount: 237.93, sale_date: "2026-09-01" });
    const result = splitRedeReimport([parsed], [saved]);
    expect(result.newRows).toHaveLength(0);
    expect(result.deltaRows).toHaveLength(0);
    expect(result.unchanged).toEqual([parsed]);
    expect(saved.nsu).toBeNull();
    expect(saved.id).toBe("orig");
  });

  it("valor reduzido gera linha de ajuste negativa com data do cancelamento e não duplica a original", () => {
    const r = splitRedeReimport([row({ amount: 60, data_cancelamento: "2026-10-05" })], [original]);
    expect(r.newRows).toHaveLength(0);
    expect(r.deltaRows).toHaveLength(1);
    expect(r.deltaRows[0].amount).toBe(-40);
    expect(r.deltaRows[0].sale_date).toBe("2026-10-05");
    expect(r.deltaRows[0].adjusts_entry_id).toBe("orig");
  });

  it("mesmo valor não gera ajuste nem nova linha", () => {
    const r = splitRedeReimport([row({ entry_key: "k-orig" })], [original]);
    expect(r.newRows).toHaveLength(0);
    expect(r.deltaRows).toHaveLength(0);
  });

  it("reimportar de novo após o ajuste não gera outro ajuste", () => {
    const adj = { id: "a1", entry_key: "x", nsu: "123", bandeira: "Visa", amount: -40, created_at: "2026-10-06" };
    const r = splitRedeReimport([row({ amount: 60 })], [original, adj]);
    expect(r.deltaRows).toHaveLength(0);
  });

  it("NSU novo entra como linha normal", () => {
    const r = splitRedeReimport([row({ nsu: "999" })], [original]);
    expect(r.newRows).toHaveLength(1);
  });
});
