import * as XLSX from "xlsx";

/**
 * Parser da planilha de Custo e Folha (uma aba por hotel).
 *
 * LIMITAÇÃO CONHECIDA: a planilha não traz CPF nem matrícula. A mesma pessoa
 * é identificada entre meses por Funcionário + Departamento + Data de Admissão
 * (`match_key`). Um erro de digitação no nome quebra esse vínculo.
 *
 * Desligamentos: quando a coluna "Data de Desligamento" passar a existir no
 * arquivo, ela é lida automaticamente (`termination_date`) e o painel passa a
 * contar desligados do mês sem nenhuma outra mudança.
 */

export interface PayrollRow {
  match_key: string;
  employee_name: string;
  cnpj: string | null;
  company: string | null;
  bond: string | null;
  position: string | null;
  department: string | null;
  admission_date: string | null;
  termination_date: string | null;
  base_salary: number | null;
  salary_base: number | null;
  fgts: number | null;
  inss_patronal: number | null;
  total_cost: number;
}

export interface PayrollSheet {
  sheetName: string;
  hotelId: string;
  rows: PayrollRow[];
  checkTotal: number | null; // linha de total da planilha (conferência)
}

export interface PayrollParseResult {
  sheets: PayrollSheet[];
  ignoredSheets: string[];
  hasTerminationColumn: boolean;
}

const norm = (v: unknown) => String(v ?? "").trim();
const ascii = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function date(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function col(header: string[], ...cands: string[]): number {
  const h = header.map(ascii);
  for (const c of cands) {
    const i = h.indexOf(ascii(c));
    if (i >= 0) return i;
  }
  for (const c of cands) {
    const i = h.findIndex((x) => x.startsWith(ascii(c)));
    if (i >= 0) return i;
  }
  return -1;
}

export function matchHotel(sheetName: string, hotels: { id: string; name: string }[]): string | null {
  const s = ascii(sheetName);
  if (!s) return null;
  const exact = hotels.find((h) => ascii(h.name) === s || ascii(h.id) === s);
  if (exact) return exact.id;
  const strip = (x: string) => x.replace(/\b(ibis|budget|styles|hotel|pousada)\b/g, "").replace(/\s+/g, " ").trim();
  const ss = strip(s);
  if (!ss) return null;
  const cands = hotels.filter((h) => strip(ascii(h.name)) === ss);
  return cands.length === 1 ? cands[0].id : null;
}

export function payrollMatchKey(name: string, department: string | null, admission: string | null) {
  return `${ascii(name)}|${ascii(department ?? "")}|${admission ?? ""}`;
}

export async function parsePayrollFile(
  file: File,
  hotels: { id: string; name: string }[],
): Promise<PayrollParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets: PayrollSheet[] = [];
  const ignoredSheets: string[] = [];
  let hasTerminationColumn = false;

  for (const sheetName of wb.SheetNames) {
    const hotelId = matchHotel(sheetName, hotels);
    if (!hotelId) { ignoredSheets.push(sheetName); continue; }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
    if (!rows.length) { ignoredSheets.push(sheetName); continue; }
    const header = (rows[0] ?? []).map(norm);
    const c = {
      cnpj: col(header, "cnpj"),
      company: col(header, "empresa"),
      bond: col(header, "vinculo"),
      name: col(header, "funcionario", "nome"),
      position: col(header, "funcao", "cargo"),
      department: col(header, "departamento", "setor"),
      admission: col(header, "data de admissao", "admissao"),
      termination: col(header, "data de desligamento", "desligamento", "data de demissao", "demissao"),
      baseSal: col(header, "sal base", "salario base"),
      salBase: col(header, "base salarial"),
      fgts: col(header, "fgts"),
      inss: col(header, "inss patronal"),
      total: col(header, "total"),
    };
    if (c.name < 0 || c.total < 0) { ignoredSheets.push(sheetName); continue; }
    if (c.termination >= 0) hasTerminationColumn = true;
    const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);
    const out: PayrollRow[] = [];
    let checkTotal: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      if (!r.some((x) => x !== null && x !== "")) continue;
      const name = norm(at(r, c.name));
      if (!name) { checkTotal = num(at(r, c.total)); continue; } // linha de total
      const department = norm(at(r, c.department)) || null;
      const admission = date(at(r, c.admission));
      out.push({
        match_key: payrollMatchKey(name, department, admission),
        employee_name: name,
        cnpj: norm(at(r, c.cnpj)) || null,
        company: norm(at(r, c.company)) || null,
        bond: norm(at(r, c.bond)) || null,
        position: norm(at(r, c.position)) || null,
        department,
        admission_date: admission,
        termination_date: date(at(r, c.termination)),
        base_salary: num(at(r, c.baseSal)),
        salary_base: num(at(r, c.salBase)),
        fgts: num(at(r, c.fgts)),
        inss_patronal: num(at(r, c.inss)),
        total_cost: num(at(r, c.total)) ?? 0,
      });
    }
    sheets.push({ sheetName, hotelId, rows: out, checkTotal });
  }
  return { sheets, ignoredSheets, hasTerminationColumn };
}
