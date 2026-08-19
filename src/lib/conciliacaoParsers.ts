import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ *
 * Normalização de texto / categorias
 * ------------------------------------------------------------------ */

export function normText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Categoria normalizada (maiúsculo, sem acento) usada nos dois lados. */
export function normCategoria(v: unknown): string {
  return normText(v);
}

const STOPWORDS = new Set([
  "HOTEL", "HOTEIS", "PLAZA", "LTDA", "ME", "EPP", "SA", "S", "A", "DE", "DA",
  "DO", "DOS", "DAS", "E", "EMPREENDIMENTOS", "HOTELARIA", "HOTELEIROS",
  "ADMINISTRACAO", "MERCURE", "IBIS", "NOVOTEL", "COMFORT", "QUALITY",
]);

function tokens(v: string): string[] {
  return normText(v)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export interface HotelRef {
  id: string;
  name: string;
  opera_property_name?: string | null;
}

/**
 * Correspondência de hotel a partir de texto livre (nome do estabelecimento
 * da operadora, "Nome" do extrato bancário etc.). Normaliza e pontua por
 * tokens distintivos, tolerando variação de grafia.
 */
export function matchHotelByText(text: string, hotels: HotelRef[]): string | null {
  const target = normText(text);
  if (!target) return null;
  const targetTokens = tokens(text);

  let best: { id: string; score: number } | null = null;

  for (const h of hotels) {
    const candidates = [h.name, h.opera_property_name].filter(Boolean) as string[];
    let score = 0;
    for (const c of candidates) {
      const cNorm = normText(c);
      if (!cNorm) continue;
      if (cNorm === target) score = Math.max(score, 1000);
      if (target.includes(cNorm) || cNorm.includes(target)) score = Math.max(score, 500);
      const cTokens = tokens(c);
      if (cTokens.length) {
        const hits = cTokens.filter((t) => targetTokens.includes(t)).length;
        if (hits > 0) {
          score = Math.max(score, hits * 100 + (hits === cTokens.length ? 50 : 0));
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { id: h.id, score };
  }

  return best ? best.id : null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function toIso(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const br = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) {
    let yyyy = br[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

export function parseMoney(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  const n = s.includes(",")
    ? Number.parseFloat(s.replace(/\./g, "").replace(",", "."))
    : Number.parseFloat(s);
  const v = Number.isFinite(n) ? n : 0;
  return negative ? -Math.abs(v) : v;
}

function hashKey(parts: (string | number)[]): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `${s.slice(0, 160)}#${(h >>> 0).toString(36)}`;
}

async function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

/* ------------------------------------------------------------------ *
 * 1. Relatório do Opera (XML)
 * ------------------------------------------------------------------ */

export interface OperaRow {
  entry_key: string;
  trx_code: string;
  trx_desc: string;
  amount: number;
  business_date: string;
  room: string;
  guest_full_name: string;
  receipt_no: string;
}

const tagValue = (el: Element, tag: string): string => {
  const node = el.getElementsByTagName(tag)[0] ?? el.getElementsByTagName(tag.toLowerCase())[0];
  return node?.textContent?.trim() ?? "";
};

export async function parseOperaXml(
  file: File,
  hotelId: string,
  activeCodes: Set<string>,
): Promise<{ rows: OperaRow[]; skipped: number; total: number }> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("XML do Opera inválido ou corrompido.");
  }

  // Qualquer elemento que contenha um TRX_CODE é considerado uma linha.
  const codeNodes = Array.from(doc.getElementsByTagName("*")).filter(
    (el) => el.tagName.toUpperCase() === "TRX_CODE",
  );
  const rowEls = Array.from(
    new Set(codeNodes.map((n) => n.parentElement).filter(Boolean) as Element[]),
  );

  const rows: OperaRow[] = [];
  let skipped = 0;

  for (const el of rowEls) {
    const trxCode = tagValue(el, "TRX_CODE").replace(/\.0+$/, "").trim();
    if (!trxCode) continue;
    if (!activeCodes.has(trxCode)) {
      skipped++;
      continue;
    }
    const credit = parseMoney(tagValue(el, "CASHIER_CREDIT"));
    const debit = parseMoney(tagValue(el, "CASHIER_DEBIT"));
    const amount = credit !== 0 ? credit : debit;
    const businessDate = toIso(tagValue(el, "BUSINESS_FORMAT_DATE"));
    const room = tagValue(el, "ROOM");
    const guest = tagValue(el, "GUEST_FULL_NAME");
    const receipt = tagValue(el, "RECEIPT_NO");

    rows.push({
      entry_key: hashKey([hotelId, trxCode, businessDate, receipt, room, guest, amount.toFixed(2)]),
      trx_code: trxCode,
      trx_desc: tagValue(el, "TRX_DESC"),
      amount,
      business_date: businessDate,
      room,
      guest_full_name: guest,
      receipt_no: receipt,
    });
  }

  return { rows, skipped, total: rowEls.length };
}

/* ------------------------------------------------------------------ *
 * 2. Relatório da operadora (Rede — Excel, cabeçalho na 2ª linha)
 * ------------------------------------------------------------------ */

export interface AcquirerRow {
  entry_key: string;
  hotel_id: string | null;
  establishment_raw: string;
  sale_date: string;
  amount: number;
  bandeira: string;
  modalidade: string;
  categoria: string;
  status: string;
}

const findCol = (header: string[], ...names: string[]): number => {
  for (const n of names) {
    const idx = header.findIndex((h) => h === normText(n));
    if (idx !== -1) return idx;
  }
  for (const n of names) {
    const idx = header.findIndex((h) => h.includes(normText(n)));
    if (idx !== -1) return idx;
  }
  return -1;
};

export async function parseAcquirerExcel(
  file: File,
  hotels: HotelRef[],
): Promise<{ rows: AcquirerRow[]; skipped: number; unmatched: string[] }> {
  const wb = XLSX.read(await readArrayBuffer(file), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, defval: null, raw: true,
  });

  // Cabeçalho na 2ª linha do arquivo.
  const headerIdx = 1;
  const header = (grid[headerIdx] ?? []).map((c) => normText(c));

  const iStatus = findCol(header, "status da venda", "status");
  const iAmount = findCol(header, "valor da venda atualizado", "valor da venda", "valor");
  const iBandeira = findCol(header, "bandeira");
  const iModalidade = findCol(header, "modalidade");
  const iDate = findCol(header, "data da venda", "data");
  const iEstab = findCol(header, "nome do estabelecimento", "estabelecimento");

  if (iStatus === -1 || iAmount === -1 || iDate === -1) {
    throw new Error("Cabeçalho da operadora não reconhecido (esperado na 2ª linha).");
  }

  const rows: AcquirerRow[] = [];
  const unmatched = new Set<string>();
  let skipped = 0;

  for (const r of grid.slice(headerIdx + 1)) {
    const status = normText(r[iStatus]);
    if (!status) continue;
    if (!(status.includes("APROVADA") || status.includes("PAGO"))) {
      skipped++;
      continue;
    }
    const amount = parseMoney(r[iAmount]);
    const saleDate = toIso(r[iDate]);
    const bandeira = String(r[iBandeira] ?? "").trim();
    const modalidade = String(r[iModalidade] ?? "").trim();
    const estab = String(r[iEstab] ?? "").trim();
    const hotelId = matchHotelByText(estab, hotels);
    if (!hotelId) {
      if (estab) unmatched.add(estab);
      skipped++;
      continue;
    }
    // Bandeira vazia = PIX; senão bandeira + modalidade formam a categoria.
    const categoria = bandeira
      ? normCategoria(`${bandeira} ${modalidade}`)
      : "PIX";

    rows.push({
      entry_key: hashKey([hotelId, saleDate, amount.toFixed(2), bandeira, modalidade, estab,
        String(r[findCol(header, "nsu", "codigo da venda", "numero do resumo")] ?? "")]),
      hotel_id: hotelId,
      establishment_raw: estab,
      sale_date: saleDate,
      amount,
      bandeira,
      modalidade,
      categoria,
      status: String(r[iStatus] ?? "").trim(),
    });
  }

  return { rows, skipped, unmatched: [...unmatched] };
}

/* ------------------------------------------------------------------ *
 * 3. Extrato bancário (Excel — aba "Lançamentos", cabeçalho na linha 10)
 * ------------------------------------------------------------------ */

export interface BankRow {
  entry_key: string;
  line_date: string;
  description: string;
  amount: number;
}

const SUMMARY_LINES = ["SALDO ANTERIOR", "SALDO TOTAL DISPONIVEL DIA"];

export async function parseBankStatement(
  file: File,
  hotels: HotelRef[],
): Promise<{ rows: BankRow[]; hotelId: string | null; accountName: string; skipped: number }> {
  const wb = XLSX.read(await readArrayBuffer(file), { type: "array", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => normText(n).startsWith("LANCAMENTOS")) ?? "";
  if (!sheetName) throw new Error('Aba "Lançamentos" não encontrada no extrato.');

  const ws = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, defval: null, raw: true,
  });

  // Linhas anteriores ao cabeçalho identificam a conta ("Nome": ...).
  let accountName = "";
  for (const r of grid.slice(0, 10)) {
    const cells = (r ?? []).map((c) => String(c ?? "").trim());
    const idx = cells.findIndex((c) => normText(c) === "NOME");
    if (idx !== -1) {
      accountName = cells.slice(idx + 1).find((c) => c.length > 0) ?? "";
      if (accountName) break;
    }
    const inline = cells.find((c) => /^nome\s*:/i.test(c));
    if (inline) {
      accountName = inline.replace(/^nome\s*:/i, "").trim();
      if (accountName) break;
    }
  }

  const hotelId = matchHotelByText(accountName, hotels);

  // Cabeçalho na linha 10 do arquivo (índice 9); com tolerância caso o
  // arquivo venha com linhas em branco removidas.
  let headerIdx = grid.findIndex((r) =>
    (r ?? []).some((c) => normText(c) === "LANCAMENTO"),
  );
  if (headerIdx === -1) headerIdx = 9;

  const header = (grid[headerIdx] ?? []).map((c) => normText(c));
  const iDate = findCol(header, "data");
  const iDesc = findCol(header, "lancamento", "historico", "descricao");
  const iValue = findCol(header, "valor r", "valor");

  if (iDate === -1 || iDesc === -1 || iValue === -1) {
    throw new Error("Cabeçalho do extrato não reconhecido (esperado na linha 10).");
  }

  const rows: BankRow[] = [];
  let skipped = 0;

  for (const r of grid.slice(headerIdx + 1)) {
    const desc = String(r[iDesc] ?? "").trim();
    if (!desc) continue;
    const descNorm = normText(desc);
    if (SUMMARY_LINES.some((s) => descNorm.includes(s))) {
      skipped++;
      continue;
    }
    const lineDate = toIso(r[iDate]);
    const amount = parseMoney(r[iValue]);
    if (!lineDate && amount === 0) continue;

    rows.push({
      entry_key: hashKey([hotelId ?? accountName, lineDate, desc, amount.toFixed(2), rows.length]),
      line_date: lineDate,
      description: desc,
      amount,
    });
  }

  return { rows, hotelId, accountName, skipped };
}
