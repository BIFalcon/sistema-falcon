import * as XLSX from "xlsx";

type ArKind = "to_invoice" | "open_folio";

export interface ParsedToInvoiceEntry {
  property_name_raw: string;
  account_number: string | null;
  account_name: string | null;
  account_type: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  transaction_date: string | null;
  original_amount: number | null;
  amount: number | null;
  paid: number | null;
  ar_open: number | null;
  confirmation_number: string | null;
  reservation_status: string | null;
  departure_date: string | null;
  entry_key: string;
}

export interface ParsedOpenFolioEntry {
  property_name_raw: string;
  confirmation_number: string | null;
  reservation_status: string | null;
  first_name: string | null;
  last_name: string | null;
  balance: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  extraction_date: string | null;
  days_open: number | null;
  company: string | null;
  travel_agent: string | null;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function toAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let str = String(value).trim().replace(/[R$\s]/g, "");
  if (str.includes(",") && (!str.includes(".") || str.lastIndexOf(",") > str.lastIndexOf("."))) {
    str = str.replace(/\./g, "").replace(",", ".");
  }
  const parsed = Number.parseFloat(str);
  return Number.isNaN(parsed) ? 0 : parsed;
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

function findCol(header: string[], ...candidates: string[]): number {
  const normalized = header.map((cell) => toAscii(normalize(cell)));
  for (const candidate of candidates) {
    const idx = normalized.findIndex((cell) => cell === toAscii(candidate) || cell.includes(toAscii(candidate)));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseToInvoice(rows: unknown[][]): ParsedToInvoiceEntry[] {
  if (rows.length < 2) return [];
  // Detecção de formato TOTVS (3 Rios Plaza). O relatório TOTVS tem 13 colunas
  // fixas — UH, TIPO UH, RESERVA, CONTA, COD.DEB, DESCRIÇÃO, NOTA, VALOR,
  // DOCUMENTO, DATA, HORA, USUARIO, Cliente — e pode vir COM ou SEM cabeçalho.
  // Opera sempre traz "Property Name" nas primeiras linhas; se não achamos
  // e o layout bate com TOTVS, delega para o parser TOTVS.
  const firstRows = rows.slice(0, 8);
  const hasOperaHeader = firstRows.some((r) =>
    (r ?? []).some((cell) => {
      const c = toAscii(normalize(cell));
      return c.includes("property name") || c === "property";
    }),
  );
  if (!hasOperaHeader) {
    const totvs = parseToInvoiceTotvs(rows);
    if (totvs) return totvs;
  }
  // O arquivo real tem:
  //   linha 0: título "Faturados" (a ignorar)
  //   linha 1: vazia
  //   linha 2: cabeçalho (17 colunas)
  //   linhas 3+: dados
  // Detectamos o cabeçalho dinamicamente procurando pela linha que contém
  // "Property Name" — assim mantemos compat com arquivos antigos.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const candidate = (rows[i] ?? []).map((cell) => toAscii(normalize(cell)));
    if (candidate.some((c) => c.includes("property name") || c === "property")) {
      headerIdx = i;
      break;
    }
  }
  const header = (rows[headerIdx] ?? []).map((cell) => normalize(cell));

  const cProp = findCol(header, "property name", "property");
  const cAcctNum = findCol(header, "account number");
  const cAcctName = findCol(header, "account name");
  const cAcctType = findCol(header, "account type");
  const cStatus = findCol(header, "status");
  const cInvNum = findCol(header, "invoice number");
  const cInvStatus = findCol(header, "invoice status");
  const cTxDate = findCol(header, "transaction date");
  const cOrig = findCol(header, "original amount");
  const cAmount = findCol(header, "amount");
  const cPaid = findCol(header, "paid");
  const cArOpen = findCol(header, "ar open");
  const cConf = findCol(header, "confirmation number");
  const cResStatus = findCol(header, "reservation status");
  const cDep = findCol(header, "departure date");

  const entries: ParsedToInvoiceEntry[] = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const propertyName = normalize(row[cProp] ?? "");
    if (!propertyName || toAscii(propertyName).startsWith("total")) continue;
    // Pula a linha de cabeçalho repetida ou linhas vazias
    if (toAscii(propertyName) === "property name") continue;

    const transactionDate = parseDate(row[cTxDate]);
    const amount = parseNumber(row[cAmount]);
    const invoiceNumber = normalize(row[cInvNum] ?? "");
    const accountNumber = normalize(row[cAcctNum] ?? "");
    const confirmationNumber = normalize(row[cConf] ?? "");
    const keyBase = `${toAscii(propertyName)}|${invoiceNumber}|${confirmationNumber}|${accountNumber}|${transactionDate ?? ""}|${amount.toFixed(2)}`;

    entries.push({
      property_name_raw: propertyName,
      account_number: accountNumber || null,
      account_name: normalize(row[cAcctName] ?? "") || null,
      account_type: normalize(row[cAcctType] ?? "") || null,
      invoice_number: invoiceNumber || null,
      // Usa Invoice Status; se não existir, cai para Status genérico.
      invoice_status:
        normalize(row[cInvStatus] ?? row[cStatus] ?? "") || null,
      transaction_date: transactionDate,
      original_amount: parseNumber(row[cOrig]) || null,
      amount: amount || null,
      paid: parseNumber(row[cPaid]) || null,
      ar_open: parseNumber(row[cArOpen]) || null,
      confirmation_number: confirmationNumber || null,
      reservation_status: normalize(row[cResStatus] ?? "") || null,
      departure_date: parseDate(row[cDep]),
      entry_key: keyBase.replace(/\s+/g, " ").slice(0, 240),
    });
  }

  return entries;
}

/**
 * Parser do relatório de Faturamento do TOTVS (usado no 3 Rios Plaza).
 * Colunas fixas (0-indexed):
 *   0 UH · 1 TIPO UH · 2 RESERVA · 3 CONTA · 4 COD.DEB · 5 DESCRIÇÃO ·
 *   6 NOTA · 7 VALOR · 8 DOCUMENTO · 9 DATA · 10 HORA · 11 USUARIO · 12 Cliente
 *
 * O arquivo pode vir COM cabeçalho (planilha manual) ou SEM cabeçalho (export
 * padrão do TOTVS já começa na linha 0 com dados). Detectamos e pulamos o
 * cabeçalho automaticamente. Retorna null se o layout não parecer TOTVS.
 *
 * Como o relatório não traz o nome do hotel, cravamos o `property_name_raw`
 * como "IBIS STYLES TRES RIOS" — o mesmo `opera_property_name` cadastrado
 * para o 3 Rios Plaza — para que a edge function faça o link com o hotel.
 */
const TOTVS_TRES_RIOS_PROPERTY = "IBIS STYLES TRES RIOS";

function isTotvsHeaderRow(row: unknown[]): boolean {
  const cells = (row ?? []).map((c) => toAscii(normalize(c)));
  return (
    cells.includes("uh") &&
    cells.some((c) => c.startsWith("cod.deb") || c.startsWith("cod deb"))
  );
}

function looksLikeTotvsDataRow(row: unknown[]): boolean {
  if (!row || row.length < 12) return false;
  const col4 = toAscii(normalize(row[4] ?? ""));
  const col5 = toAscii(normalize(row[5] ?? ""));
  // COD.DEB "FATUR" e/ou DESCRIÇÃO iniciando com "A_Faturar"/"A Faturar"
  return col4.startsWith("fatur") || col5.startsWith("a_fatur") || col5.startsWith("a fatur");
}

function parseToInvoiceTotvs(rows: unknown[][]): ParsedToInvoiceEntry[] | null {
  // Primeira linha "de dado" — pula qualquer cabeçalho detectado.
  let start = 0;
  if (isTotvsHeaderRow(rows[0] ?? [])) start = 1;
  // Confirma que a partir daí temos dado no shape TOTVS.
  const sample = rows[start] ?? [];
  if (!looksLikeTotvsDataRow(sample)) return null;

  const entries: ParsedToInvoiceEntry[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (!row.length) continue;
    // Ignora linhas de totalização/vazias.
    if (!looksLikeTotvsDataRow(row)) continue;

    const propertyName = TOTVS_TRES_RIOS_PROPERTY;
    const reserva = normalize(row[2] ?? "");
    const conta = normalize(row[3] ?? "");
    const codDeb = normalize(row[4] ?? "");
    const descricao = normalize(row[5] ?? "");
    const nota = normalize(row[6] ?? "");
    // VALOR no TOTVS costuma vir como crédito (negativo). Para "a faturar"
    // interessa o módulo do valor a ser cobrado.
    const rawValor = parseNumber(row[7] ?? 0);
    const amount = Math.abs(rawValor);
    const documento = normalize(row[8] ?? "");
    const transactionDate = parseDate(row[9]);
    const cliente = normalize(row[12] ?? "");

    const invoiceNumber = nota && nota !== "0" ? nota : (documento && documento !== "0" ? documento : null);
    const accountNumber = conta || null;
    const confirmationNumber = reserva || null;

    const keyBase = `${toAscii(propertyName)}|${invoiceNumber ?? ""}|${confirmationNumber ?? ""}|${accountNumber ?? ""}|${transactionDate ?? ""}|${amount.toFixed(2)}`;

    entries.push({
      property_name_raw: propertyName,
      account_number: accountNumber,
      account_name: cliente || null,
      // "TIPO UH" (ex.: DBC) — não é conta contábil; mantemos para referência.
      account_type: normalize(row[1] ?? "") || null,
      invoice_number: invoiceNumber,
      // TOTVS não traz status de fatura; usa a DESCRIÇÃO (A_Faturar) ou COD.DEB.
      invoice_status: descricao || codDeb || null,
      transaction_date: transactionDate,
      original_amount: amount || null,
      amount: amount || null,
      paid: null,
      ar_open: amount || null,
      confirmation_number: confirmationNumber,
      reservation_status: null,
      departure_date: null,
      entry_key: keyBase.replace(/\s+/g, " ").slice(0, 240),
    });
  }

  return entries;
}

function parseOpenFolio(rows: unknown[][]): ParsedOpenFolioEntry[] {
  if (rows.length < 4) return [];
  const header = (rows[2] ?? []).map((cell) => normalize(cell));

  const cProp = findCol(header, "property name", "property");
  const cConf = findCol(header, "confirmation number");
  const cResStatus = findCol(header, "reservation status");
  const cFirst = findCol(header, "first name");
  const cLast = findCol(header, "last name");
  const cBalance = findCol(header, "balance");
  const cArr = findCol(header, "arrival date");
  const cDep = findCol(header, "departure date");
  const cExtraction = findCol(header, "data de extracao", "extraction date");
  const cDays = findCol(header, "tempo em aberto", "days open");
  const cCompany = findCol(header, "company");
  const cTravelAgent = findCol(header, "travel agent");

  const entries: ParsedOpenFolioEntry[] = [];
  for (let i = 3; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const propertyName = normalize(row[cProp] ?? "");
    if (!propertyName || toAscii(propertyName).startsWith("total")) continue;

    entries.push({
      property_name_raw: propertyName,
      confirmation_number: normalize(row[cConf] ?? "") || null,
      reservation_status: normalize(row[cResStatus] ?? "") || null,
      first_name: normalize(row[cFirst] ?? "") || null,
      last_name: normalize(row[cLast] ?? "") || null,
      balance: parseNumber(row[cBalance]) || null,
      arrival_date: parseDate(row[cArr]),
      departure_date: parseDate(row[cDep]),
      extraction_date: parseDate(row[cExtraction]),
      days_open: Number.parseInt(String(row[cDays] ?? "").replace(/\D/g, ""), 10) || null,
      company: cCompany >= 0 ? (normalize(row[cCompany] ?? "") || null) : null,
      travel_agent: cTravelAgent >= 0 ? (normalize(row[cTravelAgent] ?? "") || null) : null,
    });
  }

  return entries;
}

export async function parseArReportFile(file: File, kind: ArKind): Promise<ParsedToInvoiceEntry[] | ParsedOpenFolioEntry[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  return kind === "to_invoice" ? parseToInvoice(rows) : parseOpenFolio(rows);
}