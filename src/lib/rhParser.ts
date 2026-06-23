import * as XLSX from "xlsx";

export type RhFormat = "POUSADA" | "ASSENSUS" | "RCASTRO" | "UNKNOWN";

export interface ParsedRhEmployee {
  employee_key: string;        // ID/matrícula normalizado
  full_name: string;
  cpf: string | null;
  role: string | null;         // cargo
  department: string | null;   // setor/departamento
  admission_date: string | null;   // YYYY-MM-DD
  dismissal_date: string | null;   // YYYY-MM-DD ou null
  birth_date: string | null;
  gender_raw: string | null;       // se a planilha trouxer
  status: "ativo" | "inativo";
  salary: number | null;
  cost_center: string | null;
  raw: Record<string, unknown>;
}

export interface ParseRhResult {
  format: RhFormat;
  employees: ParsedRhEmployee[];
  warnings: string[];
}

// ---------- helpers ----------

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function toAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  let str = String(value).trim().replace(/[R$\s]/g, "");
  if (!str) return null;
  if (str.includes(",") && (!str.includes(".") || str.lastIndexOf(",") > str.lastIndexOf("."))) {
    str = str.replace(/\./g, "").replace(",", ".");
  }
  const n = Number.parseFloat(str);
  return Number.isNaN(n) ? null : n;
}

function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const str = String(value).trim();
  const br = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function cleanCpf(value: unknown): string | null {
  const s = normalize(value).replace(/\D/g, "");
  return s.length >= 11 ? s.slice(0, 11) : s || null;
}

function findCol(header: string[], ...candidates: string[]): number {
  const stripDots = (s: string) => s.replace(/\./g, "");
  const normalized = header.map((c) => stripDots(toAscii(normalize(c))));
  for (const cand of candidates) {
    const target = stripDots(toAscii(cand));
    const idx = normalized.findIndex((h) => h === target);
    if (idx >= 0) return idx;
  }
  for (const cand of candidates) {
    const target = stripDots(toAscii(cand));
    const idx = normalized.findIndex((h) => h.includes(target));
    if (idx >= 0) return idx;
  }
  return -1;
}

function pick(row: unknown[], idx: number): unknown {
  return idx >= 0 ? row[idx] : null;
}

// ---------- format detection ----------

export function detectFormat(headers: string[]): RhFormat {
  const flat = headers.map((h) => toAscii(normalize(h))).join("|");
  if (flat.includes("assensus")) return "ASSENSUS";
  if (flat.includes("rcastro") || flat.includes("r castro") || flat.includes("r. castro")) return "RCASTRO";
  if (flat.includes("pousada") || flat.includes("ativos") || flat.includes("demitidos") || flat.includes("inativos")) return "POUSADA";
  // heurística por colunas
  if (flat.includes("matricula") && flat.includes("admissao")) {
    if (flat.includes("centro de custo")) return "ASSENSUS";
    if (flat.includes("filial")) return "RCASTRO";
    return "POUSADA";
  }
  return "UNKNOWN";
}

// ---------- generic row mapper ----------

function mapRow(row: unknown[], cols: Record<string, number>): ParsedRhEmployee | null {
  const name = normalize(pick(row, cols.name));
  if (!name) return null;
  // Descarta linhas lixo: nomes que são apenas dígitos/pontuação,
  // cabeçalhos repetidos ou rótulos como "TOTAL", "ATIVOS", etc.
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(name)) return null;
  const upper = toAscii(name).toUpperCase();
  if (
    upper === "NOME" ||
    upper === "TOTAL" ||
    upper.startsWith("FUNCIONARIO") ||
    upper.startsWith("ATIVOS") ||
    upper.startsWith("INATIVOS") ||
    upper.startsWith("DEMITIDOS")
  ) return null;
  const dismissal = parseDate(pick(row, cols.dismissal));
  const key = normalize(pick(row, cols.matricula)) ||
              cleanCpf(pick(row, cols.cpf)) ||
              toAscii(name).replace(/\s+/g, "_");
  return {
    employee_key: key,
    full_name: name,
    cpf: cleanCpf(pick(row, cols.cpf)),
    role: normalize(pick(row, cols.role)) || null,
    department: normalize(pick(row, cols.department)) || null,
    admission_date: parseDate(pick(row, cols.admission)),
    dismissal_date: dismissal,
    birth_date: parseDate(pick(row, cols.birth)),
    gender_raw: normalize(pick(row, cols.gender)) || null,
    status: dismissal ? "inativo" : "ativo",
    salary: parseNumber(pick(row, cols.salary)),
    cost_center: normalize(pick(row, cols.costCenter)) || null,
    raw: row.reduce<Record<string, unknown>>((acc, v, i) => {
      acc[`col_${i}`] = v;
      return acc;
    }, {}),
  };
}

// ---------- main parser ----------

export async function parseRhFile(file: File | ArrayBuffer): Promise<ParseRhResult> {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const warnings: string[] = [];
  const employees: ParsedRhEmployee[] = [];
  let detected: RhFormat = "UNKNOWN";

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    if (!rows.length) continue;

    // localiza linha de cabeçalho (até 10 primeiras linhas com >=3 colunas textuais)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const row = rows[i] || [];
      const textCells = row.filter((c) => typeof c === "string" && (c as string).trim().length > 1).length;
      const flat = row.map((c) => toAscii(normalize(c))).join("|");
      const flatNoDot = flat.replace(/\./g, "");
      if (
        textCells >= 3 &&
        (flat.includes("nome") ||
          flat.includes("matric") ||
          flat.includes("empregado") ||
          flat.includes("colaborador") ||
          flatNoDot.includes("cpf"))
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const header = (rows[headerIdx] as unknown[]).map((c) => normalize(c));
    const fmt = detectFormat([sheetName, ...header]);
    if (fmt !== "UNKNOWN") detected = fmt;

    const cols = {
      matricula: findCol(header, "matricula", "matrícula", "id", "codigo", "código"),
      name: findCol(header, "nome", "nome completo", "colaborador", "funcionario", "funcionário", "empregado"),
      cpf: findCol(header, "cpf", "c.p.f", "c.p.f.", "nº do c.p.f.", "n do cpf", "no do cpf"),
      role: findCol(header, "cargo", "funcao", "função"),
      department: findCol(header, "setor", "departamento", "area", "área"),
      admission: findCol(header, "admissao", "admissão", "data admissao", "data de admissao", "dt admissao"),
      dismissal: findCol(header, "demissao", "demissão", "data demissao", "desligamento", "dt demissao", "rescisao", "rescisão"),
      birth: findCol(header, "nascimento", "data nascimento", "data de nascimento", "dt nascimento"),
      gender: findCol(header, "sexo", "genero", "gênero"),
      salary: findCol(header, "salario", "salário", "remuneracao", "remuneração"),
      costCenter: findCol(header, "centro de custo", "cc", "centro custo"),
    };

    if (cols.name === -1) {
      warnings.push(`Aba "${sheetName}" sem coluna "Nome" identificável.`);
      continue;
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((c) => c !== null && c !== "")) continue;
      const emp = mapRow(row, cols);
      if (emp) employees.push(emp);
    }
  }

  // Mescla duplicatas (ex.: formato POUSADA com abas separadas ATIVOS/DEMITIDOS).
  // Mesma pessoa aparece como ativa em uma aba e demitida em outra: combinamos
  // os campos preservando admissão da aba ATIVOS e demissão da aba DEMITIDOS.
  const merged = new Map<string, ParsedRhEmployee>();
  for (const e of employees) {
    const key = e.cpf || e.employee_key;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...e, employee_key: key });
      continue;
    }
    merged.set(key, {
      ...existing,
      employee_key: key,
      cpf: existing.cpf || e.cpf,
      role: existing.role || e.role,
      department: existing.department || e.department,
      admission_date: existing.admission_date || e.admission_date,
      dismissal_date: existing.dismissal_date || e.dismissal_date,
      birth_date: existing.birth_date || e.birth_date,
      gender_raw: existing.gender_raw || e.gender_raw,
      salary: existing.salary ?? e.salary,
      cost_center: existing.cost_center || e.cost_center,
      status: (existing.dismissal_date || e.dismissal_date) ? "inativo" : "ativo",
    });
  }
  const finalEmployees = Array.from(merged.values());

  if (!finalEmployees.length) {
    warnings.push("Nenhum colaborador identificado na planilha.");
  }

  return { format: detected, employees: finalEmployees, warnings };
}