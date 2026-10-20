import * as XLSX from "xlsx";

export const RH_MONTHLY_HEADERS = ["Competência", "Hotel", "Contabilidade", "CNPJ", "Empresa", "Código", "Nome", "Cargo", "Admissão", "Situação", "Movimento", "Detalhe", "Salário contratual", "Proventos (bruto)", "Hora extra, noturno e reflexos", "Descontos", "Líquido", "Base INSS", "INSS descontado", "Base FGTS", "FGTS"];
export const RH_EXTRA_HEADERS = ["Hora extra", "Adicional noturno", "DSR / reflexos", "Feriado trabalhado"];
export const RH_DETAILED_HEADERS = [...RH_MONTHLY_HEADERS.slice(0, 14), ...RH_EXTRA_HEADERS, "Total HE, noturno e reflexos", ...RH_MONTHLY_HEADERS.slice(15)];
export const normalizeRh = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const text = (value: unknown) => String(value ?? "").trim();
const optional = (value: unknown) => text(value) || null;

export function matchHotel(name: string, hotels: { id: string; name: string }[]): string | null {
  const target = normalizeRh(name);
  if (!target) return null;
  const exact = hotels.filter((hotel) => normalizeRh(hotel.name) === target || normalizeRh(hotel.id) === target);
  if (exact.length === 1) return exact[0].id;
  const strip = (value: string) => value.replace(/\b(ibis|budget|styles|hotel|pousada)\b/g, "").replace(/\s+/g, " ").trim();
  const stripped = strip(target);
  if (!stripped) return null;
  const candidates = hotels.filter((hotel) => strip(normalizeRh(hotel.name)) === stripped || strip(normalizeRh(hotel.id)) === stripped);
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1) return null;
  // Fallback: one name's words fully contained in the other (e.g. "Jaboatão" ⊂ "Recife Jaboatão", "Cuiabá" ⊂ "Cuiabá Shopping").
  const words = new Set(stripped.split(" "));
  const subset = hotels.filter((hotel) => {
    const h = strip(normalizeRh(hotel.name)).split(" ").filter(Boolean);
    if (!h.length) return false;
    const hs = new Set(h);
    return h.every((w) => words.has(w)) || [...words].every((w) => hs.has(w));
  });
  return subset.length === 1 ? subset[0].id : null;
}

function money(value: unknown, row: number, column: string): number | null {
  if (value == null || value === "") return null;
  const raw = text(value).replace(/[R$\s]/g, "");
  const parsed = typeof value === "number" ? value : Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  if (!Number.isFinite(parsed)) throw new Error(`Linha ${row}: valor inválido em ${column}.`);
  return parsed;
}

export function monthlyDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    return parts ? monthlyDate(`${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`) : null;
  }
  const s = text(value);
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const y = Number(br?.[3] ?? iso?.[1]);
  const m = Number(br?.[2] ?? iso?.[2]);
  const d = Number(br?.[1] ?? iso?.[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

export interface RhMonthlyRow {
  hotel_id: string; employee_key: string; name: string; position: string | null;
  admission_date: string | null; status: "ativo" | "inativo"; movement: string | null; detail: string | null;
  termination_date: string | null; salary: number | null; gross_earnings: number | null;
  overtime_earnings: number | null; deductions: number | null; net_earnings: number | null;
  overtime_hours_earnings: number | null; night_earnings: number | null; reflex_earnings: number | null; holiday_earnings: number | null;
  inss_base: number | null; inss_deducted: number | null; fgts_base: number | null; fgts: number | null;
  cnpj: string | null; accounting: string | null; company: string | null;
}

export interface RhMonthlyResult {
  month: number; year: number; rows: RhMonthlyRow[]; totalRows: number;
  unknownHotels: { name: string; count: number }[];
}

export function parseRhMonthlyRows(data: unknown[][], hotels: { id: string; name: string }[]): RhMonthlyResult {
  const header = (data[0] ?? []).map(normalizeRh);
  const indices = RH_MONTHLY_HEADERS.map((column, index) => index === 14 && header.includes(normalizeRh("Total HE, noturno e reflexos"))
    ? header.indexOf(normalizeRh("Total HE, noturno e reflexos")) : header.indexOf(normalizeRh(column)));
  const extraIndices = RH_EXTRA_HEADERS.map(column => header.indexOf(normalizeRh(column)));
  if (extraIndices.some(index => index >= 0) && extraIndices.some(index => index < 0)) throw new Error("Colunas de detalhamento ausentes: " + RH_EXTRA_HEADERS.filter((_, index) => extraIndices[index] < 0).join(", ") + ".");
  const missing = RH_MONTHLY_HEADERS.filter((_, i) => indices[i] < 0);
  if (missing.length) throw new Error(`Colunas ausentes: ${missing.join(", ")}.`);
  const rows: RhMonthlyRow[] = [];
  const unknown = new Map<string, number>();
  const keys = new Set<string>();
  let month = 0, year = 0, totalRows = 0;
  for (let i = 1; i < data.length; i++) {
    const source = data[i];
    if (!source.some((value) => value != null && text(value) !== "")) continue;
    const v = (column: number) => source[indices[column]];
    const competence = text(v(0)).match(/^(0[1-9]|1[0-2])\/(20\d{2}|2100)$/);
    if (!competence) throw new Error(`Linha ${i + 1}: Competência deve estar em MM/AAAA.`);
    const rowMonth = Number(competence[1]), rowYear = Number(competence[2]);
    if (month && (rowMonth !== month || rowYear !== year)) throw new Error("A planilha contém mais de uma competência. Envie um único mês por arquivo.");
    month = rowMonth; year = rowYear; totalRows++;
    const hotelName = text(v(1)), code = text(v(5)), name = text(v(6));
    if (!hotelName || !code || !name) throw new Error(`Linha ${i + 1}: Hotel, Código e Nome são obrigatórios.`);
    const hotelId = matchHotel(hotelName, hotels);
    if (!hotelId) { unknown.set(hotelName, (unknown.get(hotelName) ?? 0) + 1); continue; }
    const key = `${hotelId}|${code}`;
    if (keys.has(key)) throw new Error(`Linha ${i + 1}: Código ${code} repetido no hotel ${hotelName}.`);
    keys.add(key);
    const situation = normalizeRh(v(9));
    if (situation !== "ativo" && situation !== "desligado") throw new Error(`Linha ${i + 1}: Situação deve ser Ativo ou Desligado.`);
    const admission = monthlyDate(v(8));
    if (optional(v(8)) && !admission) throw new Error(`Linha ${i + 1}: data de Admissão inválida.`);
    const movement = optional(v(10)), detail = optional(v(11));
    const terminationText = detail?.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1];
    const termination = normalizeRh(movement) === "desligamento" ? monthlyDate(terminationText) : null;
    rows.push({
      hotel_id: hotelId, employee_key: code, name, position: optional(v(7)), admission_date: admission,
      status: situation === "ativo" ? "ativo" : "inativo", movement, detail, termination_date: termination,
      salary: money(v(12), i + 1, RH_MONTHLY_HEADERS[12]), gross_earnings: money(v(13), i + 1, RH_MONTHLY_HEADERS[13]),
      overtime_earnings: money(v(14), i + 1, RH_MONTHLY_HEADERS[14]), deductions: money(v(15), i + 1, RH_MONTHLY_HEADERS[15]),
      overtime_hours_earnings: money(source[extraIndices[0]], i + 1, RH_EXTRA_HEADERS[0]),
      night_earnings: money(source[extraIndices[1]], i + 1, RH_EXTRA_HEADERS[1]),
      reflex_earnings: money(source[extraIndices[2]], i + 1, RH_EXTRA_HEADERS[2]),
      holiday_earnings: money(source[extraIndices[3]], i + 1, RH_EXTRA_HEADERS[3]),
      net_earnings: money(v(16), i + 1, RH_MONTHLY_HEADERS[16]), inss_base: money(v(17), i + 1, RH_MONTHLY_HEADERS[17]),
      inss_deducted: money(v(18), i + 1, RH_MONTHLY_HEADERS[18]), fgts_base: money(v(19), i + 1, RH_MONTHLY_HEADERS[19]),
      fgts: money(v(20), i + 1, RH_MONTHLY_HEADERS[20]), cnpj: optional(v(3)), accounting: optional(v(2)), company: optional(v(4)),
    });
  }
  if (!totalRows) throw new Error("Nenhum colaborador identificado na planilha.");
  return { month, year, rows, totalRows, unknownHotels: Array.from(unknown, ([name, count]) => ({ name, count })) };
}

export async function parseRhMonthlyFile(file: File | ArrayBuffer, hotels: { id: string; name: string }[]): Promise<RhMonthlyResult> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets = workbook.SheetNames.filter((name) => {
    const header = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, range: 0, defval: null })[0] ?? [];
    const normalized = header.map(normalizeRh);
    return RH_MONTHLY_HEADERS.every((column, index) => normalized.includes(normalizeRh(column)) || (index === 14 && normalized.includes(normalizeRh("Total HE, noturno e reflexos"))));
  });
  if (sheets.length !== 1) throw new Error("O arquivo deve ter uma única aba de dados do Quadro com as colunas da folha e cabeçalho na primeira linha.");
  return parseRhMonthlyRows(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheets[0]], { header: 1, defval: null, raw: true }), hotels);
}