import { describe, expect, it } from "vitest";
import { calcMetrics, type RhEmployee } from "@/hooks/useRh";
import { departuresBySector, turnoverMonthlySeries } from "@/lib/rhTurnoverAnalytics";

const employee = (id: string, overrides: Partial<RhEmployee> = {}): RhEmployee => ({
  id, hotel_id: "a", employee_key: id, name: id, cpf: null, position: null, department: null,
  admission_date: "2025-01-01", termination_date: null, termination_reason: null,
  birth_date: null, gender: null, salary: null, status: "ativo", source_format: "CONSOLIDADO",
  reference_month: 9, reference_year: 2026, upload_id: null, raw: {}, created_at: "", updated_at: "",
  ...overrides,
});

describe("Indicadores de turnover", () => {
  it("usa ((2 admissões + 1 desligamento) / 2) / 4 ativos × 100 = 37,5%", () => {
    const rows = [employee("1", { raw: { movement: "Admissão" } }), employee("2", { raw: { movement: "Admissão" } }), employee("3"), employee("4"), employee("5", { status: "inativo", raw: { movement: "Desligamento" } })];
    expect(calcMetrics(rows, 9, 2026).pctRotatividade).toBe(37.5);
  });
  it("não conta transferências de entrada ou saída na fórmula", () => {
    const metrics = calcMetrics([employee("1", { raw: { movement: "Transferência (entrada)" } }), employee("2", { status: "inativo", raw: { movement: "Transferência (saída)" } })], 9, 2026);
    expect([metrics.admitidos, metrics.inativos, metrics.pctRotatividade]).toEqual([0, 0, 0]);
  });
  it("retorna zero quando o denominador de ativos é zero", () => {
    expect(calcMetrics([employee("1", { status: "inativo", raw: { movement: "Desligamento" } })], 9, 2026).pctRotatividade).toBe(0);
  });
  it("usa o quadro ativo de cada mês, não o quadro do último mês", () => {
    const august = [employee("1", { reference_month: 8, raw: { movement: "Admissão" } }), employee("2", { reference_month: 8 })];
    const september = [employee("1"), employee("2"), employee("3"), employee("4", { raw: { movement: "Admissão" } })];
    const series = turnoverMonthlySeries([{ month: 8, year: 2026, employees: august }, { month: 9, year: 2026, employees: september }], null);
    expect(series.map((row) => row.turnover)).toEqual([25, 12.5]);
    expect(series.map((row) => row.admitted)).toEqual([1, 1]);
  });
  it("não transforma mês sem dados do hotel selecionado em turnover zero", () => {
    const series = turnoverMonthlySeries([{ month: 9, year: 2026, employees: [employee("1", { hotel_id: "b" })] }], "a");
    expect(series[0]).toMatchObject({ turnover: null, admitted: null, terminated: null });
  });
  it("agrupa por Departamento e usa Cargo quando Departamento está vazio", () => {
    expect(departuresBySector([employee("1", { department: "Recepção", position: "Recepcionista" }), employee("2", { department: " ", position: "Camareira" }), employee("3", { position: "Camareira" }), employee("4")])).toEqual([
      { name: "Camareira", total: 2 }, { name: "Não informado", total: 1 }, { name: "Recepção", total: 1 },
    ]);
  });
  it("preserva o setor do evento de desligamento e respeita o período", () => {
    const old = employee("old", { reference_month: 8, status: "inativo", position: "Camareira", raw: { movement: "Desligamento" } });
    const latest = employee("latest", { position: "Recepcionista", raw: { monthly_events: [{ movement: "Desligamento", month: 8, year: 2026, termination_date: null, employee: old }] } });
    expect(calcMetrics([latest], 9, 2026).inativos).toBe(0);
    const metrics = calcMetrics([latest], 9, 2026, 2);
    expect(metrics.inativos).toBe(1);
    expect(metrics.listaDesligamentos[0].position).toBe("Camareira");
  });
});