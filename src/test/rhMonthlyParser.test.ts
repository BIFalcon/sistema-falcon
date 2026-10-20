import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { RH_MONTHLY_HEADERS, RH_DETAILED_HEADERS, parseRhMonthlyRows, parseRhMonthlyFile, matchHotel } from "@/lib/rhMonthlyParser";
import { canUploadRh, canViewRh } from "@/lib/rhAccess";
import { calcMetrics, type RhEmployee } from "@/hooks/useRh";

const hotels = [{ id: "a", name: "Ibis Budget Divinópolis" }, { id: "b", name: "Ibis Arcoverde" }];
const row = (overrides: Record<number, unknown> = {}) => {
  const values: unknown[] = ["09/2026", "Ibis Budget Divinópolis", "R Castro", "123", "Empresa", "1", "Pessoa", "Cargo", "01/09/2026", "Ativo", null, null, 2000, 2500, 150, 350, 2150, 2400, 200, 2400, 192];
  for (const [column, value] of Object.entries(overrides)) values[Number(column)] = value;
  return values;
};
const parse = (...rows: unknown[][]) => parseRhMonthlyRows([RH_MONTHLY_HEADERS, ...rows], hotels);
const employees = (rows: ReturnType<typeof parse>["rows"]): RhEmployee[] => rows.map((value, i) => ({
  ...value, id: String(i), cpf: null, department: null, birth_date: null, gender: null,
  termination_reason: value.detail, source_format: "CONSOLIDADO", reference_month: 9, reference_year: 2026,
  upload_id: null, raw: { movement: value.movement }, created_at: "", updated_at: "",
}));

describe("Fonte mensal de RH", () => {
  it("lê HE, noturno, reflexos, feriado e total separados sem deslocar o líquido", async () => {
    const values = [...row().slice(0, 14), 584, 428.55, 206.72, 0, 1219.27, ...row().slice(15)];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RH_DETAILED_HEADERS, values]), "Quadro");
    const result = await parseRhMonthlyFile(XLSX.write(wb, { type: "array", bookType: "xlsx" }), hotels);
    expect(result.rows[0]).toMatchObject({ overtime_hours_earnings: 584, night_earnings: 428.55, reflex_earnings: 206.72, holiday_earnings: 0, overtime_earnings: 1219.27, net_earnings: 2150 });
  });
  it("preserva detalhamento ausente na planilha antiga como sem dado", () => {
    expect(parse(row()).rows[0]).toMatchObject({ overtime_hours_earnings: null, night_earnings: null, reflex_earnings: null, holiday_earnings: null, overtime_earnings: 150 });
  });
  it("lê 09/2026 do arquivo e guarda todos os valores sem calcular encargos", () => {
    const result = parse(row());
    expect([result.month, result.year]).toEqual([9, 2026]);
    expect(result.rows[0]).toMatchObject({ employee_key: "1", salary: 2000, gross_earnings: 2500, overtime_earnings: 150, deductions: 350, net_earnings: 2150, inss_base: 2400, inss_deducted: 200, fgts_base: 2400, fgts: 192, cnpj: "123", accounting: "R Castro", company: "Empresa" });
  });
  it("aceita grafia sem acentos e palavras genéricas sem ambiguidades", () => {
    expect(matchHotel(" IBIS BUDGET DIVINOPOLIS ", hotels)).toBe("a");
    expect(matchHotel("Hotel Divinópolis", hotels)).toBe("a");
    expect(matchHotel("Divinópolis", [...hotels, { id: "c", name: "Ibis Styles Divinópolis" }])).toBeNull();
  });
  it("reconhece Jaboatão e Cuiabá Shopping pelos nomes cadastrados", () => {
    const list = [{ id: "j", name: "Ibis budget Recife Jaboatão" }, { id: "c", name: "Ibis Cuiabá" }, { id: "x", name: "Condomínio Cuiabá" }];
    expect(matchHotel("Ibis Budget Jaboatão", list)).toBe("j");
    expect(matchHotel("Ibis Cuiabá Shopping", list)).toBe("c");
  });
  it("avisa cada hotel desconhecido com a quantidade exata de linhas", () => {
    const result = parse(row(), row({ 1: "Hotel desconhecido", 5: "2" }), row({ 1: "Hotel desconhecido", 5: "3" }));
    expect(result.unknownHotels).toEqual([{ name: "Hotel desconhecido", count: 2 }]);
    expect(result.totalRows).toBe(3); expect(result.rows).toHaveLength(1);
  });
  it("mantém o mesmo código em hotéis diferentes e bloqueia duplicatas no mesmo hotel", () => {
    expect(parse(row(), row({ 1: "Ibis Arcoverde" })).rows).toHaveLength(2);
    expect(() => parse(row(), row())).toThrow(/repetido/);
  });
  it("rejeita competências misturadas antes de substituir qualquer dado", () => {
    expect(() => parse(row(), row({ 0: "10/2026", 5: "2" }))).toThrow(/mais de uma competência/);
  });
  it("transferências não entram como admissões nem desligamentos e situação define o quadro ativo", () => {
    const records = parse(row({ 10: "Transferência (entrada)" }), row({ 5: "2", 9: "Desligado", 10: "Transferência (saída)", 11: "em 02/09/2026" })).rows;
    expect(records[1].termination_date).toBeNull();
    const metrics = calcMetrics(employees(records), 9, 2026);
    expect(metrics.ativos).toBe(1); expect(metrics.admitidos).toBe(0); expect(metrics.inativos).toBe(0);
  });
  it("desligamento sem data entra no evento mensal, sem inventar uma data", () => {
    const records = parse(row({ 8: "01/01/2025", 9: "Desligado", 10: "Desligamento", 11: "Demitido SEM justa causa" })).rows;
    expect(records[0].termination_date).toBeNull();
    expect(calcMetrics(employees(records), 9, 2026).inativos).toBe(1);
  });
  it("preserva a data e o motivo de desligamento do detalhe", () => {
    expect(parse(row({ 9: "Desligado", 10: "Desligamento", 11: "em 02/09/2026 — Demitido SEM justa causa" })).rows[0]).toMatchObject({ termination_date: "2026-09-02", detail: "em 02/09/2026 — Demitido SEM justa causa" });
  });
  it("preserva eventos dos meses anteriores sem mudar a situação da foto mais recente", () => {
    const record = employees(parse(row({ 8: "01/07/2026" })).rows)[0];
    record.raw.monthly_events = [{ movement: "Admissão", month: 7, year: 2026, termination_date: null }, { movement: "Transferência (entrada)", month: 9, year: 2026, termination_date: null }];
    const metrics = calcMetrics([record], 9, 2026, 3);
    expect(metrics.admitidos).toBe(1); expect(metrics.ativos).toBe(1); expect(metrics.inativos).toBe(0);
  });
  it("não infere CPF, nascimento nem gênero na fonte nova", () => {
    expect(parse(row()).rows[0]).not.toHaveProperty("gender");
    expect(parse(row()).rows[0]).not.toHaveProperty("cpf");
    expect(parse(row()).rows[0]).not.toHaveProperty("birth_date");
  });
  it("encontra a única aba de dados sem usar a aba resumo", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Hotel", "Total"], ["Resumo", 10]]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RH_MONTHLY_HEADERS, row()]), "Quadro");
    const result = await parseRhMonthlyFile(XLSX.write(wb, { type: "array", bookType: "xlsx" }), hotels);
    expect(result.rows).toHaveLength(1); expect(result.month).toBe(9);
  });
});

describe("Acesso RH mensal", () => {
  it("somente RH e Master enviam", () => {
    expect(canUploadRh(["rh"])).toBe(true); expect(canUploadRh(["processos"])).toBe(true);
    for (const role of ["fernando", "viewer", "gg", "gop", "adm"]) expect(canUploadRh([role])).toBe(false);
  });
  it("permite os seis papéis definidos para visualização e nunca ADM", () => {
    for (const role of ["processos", "rh", "fernando", "viewer", "gop", "gg"]) expect(canViewRh([role])).toBe(true);
    expect(canViewRh(["adm"])).toBe(false); expect(canViewRh([])).toBe(false);
  });
});