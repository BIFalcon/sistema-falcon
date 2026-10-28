// Pure OMIE row parsing shared by the upload handler and regression tests.
import { getOmiePaymentColumns, readOmiePaymentDetails } from "./omiePaymentDetails.ts";

export type ParsedEntry = {
  entry_key: string;
  supplier: string;
  cnpj: string | null;
  document_number: string | null;
  description: string | null;
  due_date: string | null;
  amount: number;
  payment_method: string | null;
  category: string | null;
  observation: string | null;
  interest_fees: number | null;
  omie_situation: string | null;
  is_distribution: boolean;
  raw: Record<string, any>;
  barcode?: string | null;
  pix_key?: string | null;
  beneficiary_bank?: string | null;
  beneficiary_agency?: string | null;
  beneficiary_account?: string | null;
  beneficiary_name?: string | null;
  beneficiary_tax_id?: string | null;
  payment_document_number?: string | null;
  source_document_type?: string | null;
  source_registered_date?: string | null;
  source_forecast_date?: string | null;
  source_due_date?: string | null;
};

type SkippedCounters = {
  other_bank: number;
  no_amount: number;
  no_supplier: number;
  duplicate_entry: number;
};

function normalize(s: any): string {
  return String(s ?? "").trim();
}

function toAscii(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  s = s.replace(/[R$\s]/g, "");
  // formato BR: milhares com . e decimal com ,
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  // Excel serial number
  if (typeof v === "number") {
    // Excel epoch: 1899-12-30 (accounts for the 1900 leap year bug)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const s = String(v).trim();
  // dd/mm/yyyy
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = "20" + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function makeKey(
  supplier: string,
  doc: string | null,
  due: string | null,
  amount: number,
  idx = 0,
): string {
  const base = `${toAscii(supplier)}|${(doc ?? "").toString().trim()}|${due ?? ""}|${amount.toFixed(2)}`;
  const key = base.replace(/\s+/g, " ");
  // idx > 0 diferencia duplicatas legítimas (ex: 4 parcelas INSS idênticas)
  return (idx > 0 ? `${key}|dup${idx}` : key).slice(0, 240);
}

function emptySkipped(): SkippedCounters {
  return { other_bank: 0, no_amount: 0, no_supplier: 0, duplicate_entry: 0 };
}

function isDistributionEntry(category: string | null, description: string | null): boolean {
  const blob = `${toAscii(category ?? "")} ${toAscii(description ?? "")}`;
  return blob.includes("distribuicao de lucros");
}

function findCol(header: string[], ...candidates: string[]): number {
  const norm = header.map((h) => toAscii(normalize(h)));
  for (const c of candidates) {
    const target = toAscii(c);
    // Tenta match exato primeiro (header OMIE tem variantes do tipo
    // "Razão Social" e "Minha Empresa (Razão Social)" — exato evita confusão).
    let i = norm.findIndex((h) => h === target);
    if (i < 0) i = norm.findIndex((h) => h.includes(target));
    if (i >= 0) return i;
  }
  return -1;
}

function isAllowedBank(_account: string): boolean {
  return true; // aceita qualquer conta corrente do OMIE
}

export function parseOmieRows(rows: unknown[][]): {
  entries: ParsedEntry[];
  skipped: SkippedCounters;
  my_company_cnpj: string | null;
} {
  // OMIE real (planilha padrão de exportação):
  // linha 0 = título "Contas a Pagar"
  // linha 1 = cabeçalho com 9 colunas: Situação, CNPJ/CPF, Razão Social, Vencimento,
  //           Categoria, Nota Fiscal, A Pagar ou Receber, Observação da Conta, Conta Corrente
  // linha 2 = totalizador geral (sem fornecedor — será ignorado pelo filtro de supplier vazio)
  // linhas 3+ = dados reais. Valores de "A Pagar ou Receber" são sempre negativos — usar Math.abs().
  if (rows.length < 3) return { entries: [], skipped: emptySkipped(), my_company_cnpj: null };
  let headerIdx = 1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = (rows[i] ?? []).map((c: any) => toAscii(normalize(c)));
    // Detecta cabeçalho pela presença de 'vencimento' E ('razao social' OU 'situacao')
    if (row.some((c) => c.includes("vencimento")) && (
      row.some((c) => c.includes("razao social")) ||
      row.some((c) => c.includes("situacao"))
    )) {
      headerIdx = i;
      break;
    }
  }
  const headerArr = (rows[headerIdx] ?? []).map((h: any) => normalize(h));
  // CNPJ da empresa que exportou (próprio hotel) — usado para validar se o
  // arquivo é do hotel selecionado.
  const colMyCnpj = (() => {
    const norm = headerArr.map((h: string) => toAscii(h));
    return norm.findIndex((h) => h.includes("minha empresa") && h.includes("cnpj"));
  })();
  // Colunas reais do OMIE (115 cols). Pulamos as variantes "Minha Empresa (...)".
  const colSit = findCol(headerArr, "situacao");
  const colSitVenc = findCol(headerArr, "situacao do vencimento");
  // CNPJ do fornecedor — preferimos 'CNPJ/CPF' e evitamos 'Minha Empresa (CNPJ)'.
  let colCnpj = findCol(headerArr, "cnpj/cpf");
  if (colCnpj < 0) {
    // fallback: primeiro 'cnpj' que NÃO seja 'minha empresa'
    const norm = headerArr.map((h: string) => toAscii(h));
    colCnpj = norm.findIndex((h) => h.includes("cnpj") && !h.includes("minha empresa"));
  }
  // Razão Social do fornecedor — evitar 'Minha Empresa (Razão Social)'.
  let colSupplier = -1;
  {
    const norm = headerArr.map((h: string) => toAscii(h));
    colSupplier = norm.findIndex((h) => h === "razao social");
    if (colSupplier < 0) colSupplier = norm.findIndex((h) => h.includes("razao social") && !h.includes("minha empresa"));
    if (colSupplier < 0) colSupplier = findCol(headerArr, "fornecedor");
  }
  const colDue = findCol(headerArr, "data de vencimento (completa)", "vencimento");
  const paymentColumns = getOmiePaymentColumns(headerArr);
  const colCategory = findCol(headerArr, "categoria");
  const colDoc = findCol(headerArr, "nota fiscal", "documento");
  // Planilha real: "A Pagar ou Receber". Manter fallbacks para compatibilidade.
  const colAmount = findCol(headerArr, "a pagar ou receber", "a pagar", "valor", "receber");
  const colObs = findCol(headerArr, "observacao da conta", "observacao", "observa");
  // Exact payer account only: Conta Corrente para Transferência belongs to the beneficiary.
  const colBank = headerArr.findIndex((h) => toAscii(h) === "conta corrente");
  const colPayMethod = findCol(headerArr, "forma de pagamento");

  const out: ParsedEntry[] = [];
  const skipped = emptySkipped();
  let myCompanyCnpj: string | null = null;
  const keyCount = new Map<string, number>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const supplier = normalize(row[colSupplier] ?? "");
    if (!supplier) { skipped.no_supplier++; continue; }
    const lower = toAscii(supplier);
    if (lower.includes("total") || lower === "razao social") continue;
    if (!myCompanyCnpj && colMyCnpj >= 0) {
      const v = normalize(row[colMyCnpj] ?? "").replace(/\D/g, "");
      if (v.length >= 11) myCompanyCnpj = v;
    }
    // Filtro de banco
    const bank = colBank >= 0 ? normalize(row[colBank] ?? "") : "";
    if (bank && !isAllowedBank(bank)) {
      skipped.other_bank++;
      continue;
    }
    const amountRaw = row[colAmount];
    const amount = Math.abs(parseNumber(amountRaw));
    if (amount <= 0) { skipped.no_amount++; continue; }
    const docNumber = normalize(row[colDoc] ?? "");
    const paymentDetails = readOmiePaymentDetails(row, paymentColumns, parseDate);
    const forecastRaw = row[paymentColumns.source_forecast_date];
    const due = normalize(forecastRaw) ? paymentDetails.source_forecast_date : parseDate(row[colDue]);
    const sitVenc = colSitVenc >= 0 ? normalize(row[colSitVenc] ?? "") : "";
    const sit = colSit >= 0 ? normalize(row[colSit] ?? "") : "";
    // Block 3: duplicatas legítimas (mesmo fornecedor/doc/data/valor)
    // recebem sufixo |dup1, |dup2... para serem todas importadas.
    const rawKey = makeKey(supplier, docNumber, due, amount);
    const count = keyCount.get(rawKey) ?? 0;
    keyCount.set(rawKey, count + 1);
    const entryKey = makeKey(supplier, docNumber, due, amount, count);
    out.push({
      ...paymentDetails,
      entry_key: entryKey,
      supplier,
      cnpj: normalize(row[colCnpj] ?? "") || null,
      document_number: docNumber || null,
      description: null,
      due_date: due,
      amount,
      payment_method: colPayMethod >= 0 ? normalize(row[colPayMethod] ?? "") || null : null,
      category: normalize(row[colCategory] ?? "") || null,
      observation: normalize(row[colObs] ?? "") || null,
      interest_fees: null,
      omie_situation: sit || null,
      is_distribution: isDistributionEntry(normalize(row[colCategory] ?? ""), null),
      raw: { row, header: headerArr, situacao_vencimento: sitVenc, conta_corrente: bank },
    });
  }
  return { entries: out, skipped, my_company_cnpj: myCompanyCnpj };
}

