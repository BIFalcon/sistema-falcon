import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exercise the ordered rules in the deployed SQL, not a second client-side mapping.
const sql = readFileSync("drizzle/migrations/0040_rh_department_andar.sql", "utf8");
const rules = Array.from(sql.matchAll(/WHEN p ~ '([^']+)' THEN '([^']+)'/g), ([, pattern, department]) => ({ pattern: new RegExp(pattern), department }));
const classify = (position: string) => {
  const normalized = position.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").toLowerCase();
  return rules.find(({ pattern }) => pattern.test(normalized))?.department ?? null;
};

describe("Classificação aprovada dos departamentos de RH", () => {
  it("inclui reservas em Hospedagem", () => {
    expect(classify("ANALISTA DE DISTRIBUICAO E RESERVAS")).toBe("Hospedagem");
    expect(classify("Anfitrião (ã) de reservas")).toBe("Hospedagem");
  });
  it("inclui comercial em Hospedagem", () => {
    expect(classify("Assistente Comercial")).toBe("Hospedagem");
  });
  it("inclui Serviços Gerais em Governança", () => {
    expect(classify("Serviços Gerais")).toBe("Governança");
    expect(classify("AUXILIAR DE SERVIÇOES GERAIS")).toBe("Governança");
  });
  it.each([
    ["Auditor Noturno", "Hospedagem"],
    ["Camareiro(a) de hotel", "Governança"],
    ["Supervisor de Andar", "Governança"],
    ["Anfitrião A & B", "Alimentos & Bebidas"],
    ["ATENDENTE DE A E B - NIVEL II", "Alimentos & Bebidas"],
    ["Oficial de Manutenção Predial", "Manutenção"],
    ["Almoxarife", "Administrativo, Financeiro & Controladoria"],
    ["Aprendiz de Programador de sistemas de informação", "Administrativo, Financeiro & Controladoria"],
    ["Subgerente de Operações Regi", "Gestão & Operações"],
    ["Assistente de Pessoa e Cultura", "Recursos Humanos"],
  ])("classifica %s no grupo aprovado", (position, department) => {
    expect(classify(position)).toBe(department);
  });
  it("não inventa departamento para cargos genéricos ou inválidos", () => {
    expect(classify("JOVEM APRENDIZ")).toBeNull();
    expect(classify("33")).toBeNull();
    expect(classify("")).toBeNull();
  });
});