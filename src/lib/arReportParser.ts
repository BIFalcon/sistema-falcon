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
  const header = rows[0].map((cell) => normalize(cell));

  const cProp = findCol(header, "property name", "property");
  const cAcctNum = findCol(header, "account number");
  const cAcctName = findCol(header, "account name");
  const cAcctType = findCol(header, "account type");
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
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const propertyName = normalize(row[cProp] ?? "");
    if (!propertyName || toAscii(propertyName).startsWith("total")) continue;

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
      invoice_status: normalize(row[cInvStatus] ?? "") || null,
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