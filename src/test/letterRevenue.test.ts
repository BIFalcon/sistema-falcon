import { describe, expect, it } from "vitest";
import { findLetterDreValue, getLetterRevenueRows } from "@/lib/letterRevenue";

const lines = [
  { label: "Receita de Hospedagem", value: 1052235.78 },
  { label: "Outras Receitas de Hospedagem", value: 14515.41 },
  { label: "Receita de A&B", value: 72063.39 },
  { label: "Receitas com Aluguéis", value: 4080.12 },
  { label: "Outras Receitas de Serviços e Vendas", value: 25.75 },
  { label: "Outras Receitas Operacionais", value: 4515.96 },
];

describe("composição da receita na Carta", () => {
  it("discrimina as seis receitas do Manhattan sem reutilizar outras receitas de hospedagem", () => {
    const values = getLetterRevenueRows("manhattan-poa").map((row) => findLetterDreValue(lines, row.rx));
    expect(values).toEqual([1052235.78, 14515.41, 72063.39, 4080.12, 25.75, 4515.96]);
    expect(values.map((value) => Math.round(value ?? 0))).toEqual([1052236, 14515, 72063, 4080, 26, 4516]);
    expect(values.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(1147436.41, 2);
  });

  it("preserva a composição genérica de outros hotéis", () => {
    const generic = [...lines, { label: "Receita Bruta de Serviços", value: 123 }, { label: "Receita Financeira Líquida", value: 456 }];
    expect(getLetterRevenueRows("ibis-macae").map((row) => findLetterDreValue(generic, row.rx)))
      .toEqual([123, 72063.39, 456, 14515.41]);
  });

  it("não inventa valor para receita ausente", () => {
    const rental = getLetterRevenueRows("manhattan-poa")[3];
    expect(findLetterDreValue([], rental.rx)).toBeNull();
  });
});