import { describe, expect, it } from "vitest";
import { conciliationBase, conciliationCategoryKey, operaClassification } from "@/lib/conciliationCategory";

describe("Opera base and OMIE category", () => {
  it("routes card by CARTAO but crosses with the Visa Crédito OMIE category", () => {
    expect(operaClassification({ categoria: "CARTAO", categoria_omie: "Visa Crédito" })).toEqual({
      base_conciliacao: "CARTAO", categoria_omie: "Visa Crédito", categoria: "VISA CREDITO",
    });
    expect(conciliationCategoryKey("Visa Crédito")).toBe(conciliationCategoryKey("VISA CREDITO"));
    expect(conciliationCategoryKey("Visa Crédito")).not.toBe(conciliationCategoryKey("Visa Débito"));
  });
  it("routes PIX independently of the OMIE label", () => {
    expect(operaClassification({ categoria: "PIX", categoria_omie: "Recebimentos balcão" }).base_conciliacao).toBe("PIX");
  });
  it("routes cash by DINHEIRO independently of the OMIE label", () => {
    expect(operaClassification({ categoria: "DINHEIRO", categoria_omie: "Caixa balcão" }).base_conciliacao).toBe("DINHEIRO");
  });
  it("does not route FATURADO or an unset base to cards", () => {
    expect(conciliationBase("FATURADO")).toBe("FATURADO");
    expect(conciliationBase(null)).toBeNull();
    expect(conciliationBase("Visa Credito")).toBeNull();
  });
  it("never substitutes CARTAO for an absent OMIE category", () => {
    expect(operaClassification({ categoria: "CARTAO", categoria_omie: null })).toEqual({
      base_conciliacao: "CARTAO", categoria_omie: null, categoria: null,
    });
  });
  it("recognizes the existing American Express and Diners spellings", () => {
    expect(conciliationCategoryKey("American Express")).toBe("AMEX CREDITO");
    expect(conciliationCategoryKey("Diners Club")).toBe("DINERS");
  });
});