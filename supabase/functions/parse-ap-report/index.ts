// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import * as XLSX from "npm:xlsx@0.18.5";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedEntry = {
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

function sanitizeFileName(name: string): string {
  // Remove acentos e troca caracteres não permitidos pelo Supabase Storage
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
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

// Stable identity used to preserve user-attached documents across re-uploads,
// even when due_date or amount change. Uses ONLY supplier (normalized) +
// document number — matches the SQL backfill of `lookup_key`.
function makeLookupKey(supplier: string, doc: string | null): string {
  const sup = toAscii(supplier).replace(/\s+/g, " ").trim();
  const docNorm = (doc ?? "").toString().trim();
  return `${sup}|${docNorm}`.slice(0, 240);
}

function emptySkipped(): SkippedCounters {
  return { other_bank: 0, no_amount: 0, no_supplier: 0, duplicate_entry: 0 };
}

function dedupeParsedEntries(entries: ParsedEntry[], skipped: SkippedCounters): ParsedEntry[] {
  const seen = new Set<string>();
  const unique: ParsedEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.entry_key)) {
      skipped.duplicate_entry++;
      continue;
    }
    seen.add(entry.entry_key);
    unique.push(entry);
  }
  return unique;
}

function isDistributionEntry(category: string | null, description: string | null): boolean {
  const blob = `${toAscii(category ?? "")} ${toAscii(description ?? "")}`;
  return blob.includes("distribuicao de lucros");
}

function parseTotvsXls(buf: ArrayBuffer): ParsedEntry[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const out: ParsedEntry[] = [];
  const keyCount = new Map<string, number>();
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const supplier = normalize(row[0]);
    const description = normalize(row[2]);
    const docNumber = normalize(row[3]);
    const dueRaw = row[5];
    const paymentMethod = normalize(row[6]);
    const interest = parseNumber(row[9]);
    const amount = parseNumber(row[11]);
    if (!supplier || amount <= 0) continue;
    // pula cabeçalhos / totais
    const lower = toAscii(supplier);
    if (lower.includes("fornecedor") || lower.includes("total") || lower.includes("relat")) continue;
    const due = parseDate(dueRaw);
    const rawKey = makeKey(supplier, docNumber, due, amount);
    const count = keyCount.get(rawKey) ?? 0;
    keyCount.set(rawKey, count + 1);
    const entryKey = makeKey(supplier, docNumber, due, amount, count);
    out.push({
      entry_key: entryKey,
      supplier,
      cnpj: null,
      document_number: docNumber || null,
      description: description || null,
      due_date: due,
      amount,
      payment_method: paymentMethod || null,
      category: null,
      observation: null,
      interest_fees: interest || null,
      omie_situation: null,
      is_distribution: isDistributionEntry(null, description),
      raw: { row },
    });
  }
  return out;
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

// OMIE: somente "Em Aprovação" e "Agendado" indicam que o GG já aprovou.
// Demais situações (a vencer, vence hoje, atrasado, etc.) = não aprovado.
function omieApprovalFromSituation(sit: string | null): "pending" | "approved" {
  const s = toAscii(sit ?? "").toLowerCase();
  if (s.includes("em aprovacao") || s.includes("agendado")) return "approved";
  return "pending";
}

// Mapeia situação OMIE para o status de pagamento Falcon
type ApPaymentStatus =
  | "em_aprovacao"
  | "autorizado"
  | "agendado"
  | "pago"
  | "pago_parcialmente"
  | "nao_aprovado_gg";
function omieStatusToFalcon(situacao: string | null | undefined): ApPaymentStatus {
  if (!situacao) return "nao_aprovado_gg";
  const s = toAscii(situacao).toLowerCase();
  if (s.includes("agendado")) return "agendado";
  if (s.includes("pago parcialmente")) return "pago_parcialmente";
  if (s.includes("pago") || s.includes("liquidado")) return "pago";
  // SOMENTE "Em Aprovação" no OMIE entra como "Em Aprovação" no sistema.
  if (s.includes("em aprovacao")) return "em_aprovacao";
  // "a vencer", "vence hoje", "vencido", "atrasado", etc. = Não aprovado pelo GG
  return "nao_aprovado_gg";
}

// Normaliza a conta corrente para "itau" | "santander" | null
function normalizeBank(account: string | null | undefined): string | null {
  const a = toAscii(account ?? "");
  if (!a) return null;
  if (a.includes("itau")) return "itau";
  if (a.includes("santander")) return "santander";
  return null;
}

function parseOmieXlsx(buf: ArrayBuffer, hotelId: string): {
  entries: ParsedEntry[];
  skipped: SkippedCounters;
  my_company_cnpj: string | null;
} {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
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
    if (row.includes("vencimento") && (
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
  const colDue = findCol(headerArr, "vencimento");
  const colCategory = findCol(headerArr, "categoria");
  const colDoc = findCol(headerArr, "nota fiscal", "documento");
  // Planilha real: "A Pagar ou Receber". Manter fallbacks para compatibilidade.
  const colAmount = findCol(headerArr, "a pagar ou receber", "a pagar", "valor", "receber");
  const colObs = findCol(headerArr, "observacao da conta", "observacao", "observa");
  const colBank = findCol(headerArr, "conta corrente");
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
    const due = parseDate(row[colDue]);
    const sitVenc = colSitVenc >= 0 ? normalize(row[colSitVenc] ?? "") : "";
    const sit = colSit >= 0 ? normalize(row[colSit] ?? "") : "";
    // Block 3: duplicatas legítimas (mesmo fornecedor/doc/data/valor)
    // recebem sufixo |dup1, |dup2... para serem todas importadas.
    const rawKey = makeKey(supplier, docNumber, due, amount);
    const count = keyCount.get(rawKey) ?? 0;
    keyCount.set(rawKey, count + 1);
    const entryKey = makeKey(supplier, docNumber, due, amount, count);
    out.push({
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

async function extractFromZip(buf: ArrayBuffer): Promise<{
  reportBuf: ArrayBuffer | null;
  reportName: string | null;
  documents: { name: string; data: Uint8Array; mime: string }[];
}> {
  const zip = await JSZip.loadAsync(buf);
  let reportBuf: ArrayBuffer | null = null;
  let reportName: string | null = null;
  const documents: { name: string; data: Uint8Array; mime: string }[] = [];
  const entries = Object.values(zip.files).filter((f: any) => !f.dir);
  // primeiro xlsx vira relatório
  for (const f of entries as any[]) {
    const lower = f.name.toLowerCase();
    if (!reportBuf && lower.endsWith(".xlsx")) {
      const data = await f.async("arraybuffer");
      reportBuf = data;
      reportName = f.name.split("/").pop() ?? f.name;
    }
  }
  // demais arquivos viram documentos
  for (const f of entries as any[]) {
    const lower = f.name.toLowerCase();
    if (reportName && (f.name.split("/").pop() ?? f.name) === reportName) continue;
    const data = await f.async("uint8array");
    let mime = "application/octet-stream";
    if (lower.endsWith(".pdf")) mime = "application/pdf";
    else if (lower.endsWith(".xml")) mime = "application/xml";
    else if (lower.endsWith(".ofx")) mime = "application/x-ofx";
    else if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    documents.push({ name: f.name.split("/").pop() ?? f.name, data, mime });
  }
  return { reportBuf, reportName, documents };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const hotelId = String(form.get("hotel_id") ?? "");
    const sourceSystem = String(form.get("source_system") ?? "") as "totvs" | "omie";
    if (!file || !hotelId || !["totvs", "omie"].includes(sourceSystem)) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Verifica permissão (financeiro/master + hotel allowed)
    const { data: isManager } = await admin.rpc("is_ap_manager", { _user_id: userId });
    const { data: isAllowed } = await admin.rpc("is_hotel_allowed", { _user_id: userId, _hotel_id: hotelId });
    if (!isManager || !isAllowed) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca CNPJ do hotel para validação posterior
    const { data: hotelData } = await admin
      .from("hotels")
      .select("cnpj")
      .eq("id", hotelId)
      .maybeSingle();
    const hotelCnpjDigits = (hotelData?.cnpj ?? "").replace(/\D/g, "");

    const arrayBuf = await file.arrayBuffer();
    const lowerName = file.name.toLowerCase();

    let parsed: ParsedEntry[] = [];
    let skipped: SkippedCounters | null = null;
    let myCompanyCnpj: string | null = null;
    let reportBuf: ArrayBuffer = arrayBuf;
    let reportName = file.name;
    let extractedDocs: { name: string; data: Uint8Array; mime: string }[] = [];

    if (sourceSystem === "omie" && lowerName.endsWith(".zip")) {
      const ext = await extractFromZip(arrayBuf);
      if (!ext.reportBuf) {
        return new Response(JSON.stringify({ error: "zip_sem_xlsx" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      reportBuf = ext.reportBuf;
      reportName = ext.reportName ?? file.name;
      extractedDocs = ext.documents;
      const r = parseOmieXlsx(reportBuf, hotelId);
      parsed = r.entries; skipped = r.skipped; myCompanyCnpj = r.my_company_cnpj;
    } else if (sourceSystem === "omie") {
      const r = parseOmieXlsx(arrayBuf, hotelId);
      parsed = r.entries; skipped = r.skipped; myCompanyCnpj = r.my_company_cnpj;
    } else {
      skipped = emptySkipped();
      parsed = dedupeParsedEntries(parseTotvsXls(arrayBuf), skipped);
    }

    // Validação de CNPJ do hotel: comparamos o CNPJ da coluna "Minha Empresa
    // (CNPJ)" da planilha (= CNPJ de quem exportou) com o CNPJ cadastrado do
    // hotel. NÃO comparamos contra o CNPJ do fornecedor — esse é sempre
    // diferente do hotel.
    if (hotelCnpjDigits && myCompanyCnpj && myCompanyCnpj !== hotelCnpjDigits) {
      return new Response(
        JSON.stringify({
          error: `CNPJ da empresa exportadora na planilha (${myCompanyCnpj}) não corresponde ao CNPJ cadastrado para o hotel selecionado. Verifique se importou o arquivo correto.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ts = Date.now();
    const reportPath = `${hotelId}/reports/${ts}-${sanitizeFileName(reportName)}`;
    const { error: upErr } = await admin.storage
      .from("accounts-payable")
      .upload(reportPath, new Uint8Array(reportBuf), {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) throw upErr;

    // ── Upload preservando vínculos por entry_key ──
    // 1. lê entries existentes (paginado — Supabase limita 1000 por request)
    const existing: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: page, error: pErr } = await admin
        .from("ap_entries")
        .select("id, entry_key, lookup_key, gg_approval, gg_approval_by, gg_approval_at, gg_approval_notes, primary_document_id, observation, archived_at, payment_status, original_amount")
        .eq("hotel_id", hotelId)
        .range(from, from + pageSize - 1);
      if (pErr) throw pErr;
      if (!page || page.length === 0) break;
      existing.push(...page);
      if (page.length < pageSize) break;
    }
    const existingByKey = new Map<string, any>();
    const existingByLookup = new Map<string, any>();
    for (const e of existing) {
      existingByKey.set(e.entry_key, e);
      if (e.lookup_key) existingByLookup.set(e.lookup_key, e);
    }

    // 2. insere novo upload
    const { data: uploadRow, error: uErr } = await admin
      .from("ap_uploads")
      .insert({
        hotel_id: hotelId,
        kind: "report",
        source_system: sourceSystem,
        file_name: reportName,
        file_path: reportPath,
        file_size: reportBuf.byteLength,
        uploaded_by: userId,
        parsed_entries_count: parsed.length,
      })
      .select()
      .single();
    if (uErr) throw uErr;

    // 3. separa em (a) atualizar existentes — preservando vínculos — e (b) inserir novos
    const seenKeys = new Set<string>();
    const updatedIds = new Set<string>();
    const updates: any[] = [];
    const inserts: any[] = [];
    for (const p of parsed) {
      seenKeys.add(p.entry_key);
      const lookup = makeLookupKey(p.supplier, p.document_number);
      // Match em cascata: 1) entry_key exato, 2) lookup_key (supplier+doc).
      // O segundo permite preservar vínculo de documento mesmo quando o
      // financeiro re-importa a planilha com mudanças em valor/vencimento.
      let prev = existingByKey.get(p.entry_key);
      if (!prev && p.document_number) {
        const candidate = existingByLookup.get(lookup);
        // Evita reusar o mesmo registro pra duas linhas novas
        if (candidate && !updatedIds.has(candidate.id)) prev = candidate;
      }
      // OMIE: 'Em Aprovação' = GG já aprovou. 'Agendado' = já foi pro banco.
      let approvalDefault: "pending" | "approved" | "rejected" = "pending";
      if (sourceSystem === "omie") {
        approvalDefault = omieApprovalFromSituation(p.omie_situation);
      }
      const baseFields = {
        hotel_id: hotelId,
        upload_id: uploadRow.id,
        source_system: sourceSystem,
        entry_key: p.entry_key,
        lookup_key: lookup,
        supplier: p.supplier,
        cnpj: p.cnpj,
        document_number: p.document_number,
        description: p.description,
        due_date: p.due_date,
        amount: p.amount,
        payment_method: p.payment_method,
        category: p.category,
        interest_fees: p.interest_fees,
        omie_situation: p.omie_situation,
        is_distribution: p.is_distribution,
        raw: p.raw,
        archived_at: null,
        bank_account: normalizeBank((p.raw as any)?.conta_corrente ?? null),
        hotel_cnpj: hotelCnpjDigits || null,
      };
      const omieFalconStatus = sourceSystem === "omie" ? omieStatusToFalcon(p.omie_situation) : "em_aprovacao";
      if (prev) {
        updatedIds.add(prev.id);
        // Nova remessa substitui TUDO — apenas observation (comentário) é preservado
        const preservedStatus = omieFalconStatus;
        updates.push({
          id: prev.id,
          ...baseFields,
          observation: prev.observation ?? null, // preserva comentário
          payment_status: preservedStatus,
          // Preserva original_amount: nunca sobrescreve se já existe;
          // garante valor para registros antigos que ainda não têm.
          original_amount: prev.original_amount ?? p.amount,
        });
      } else {
        inserts.push({
          ...baseFields,
          observation: p.observation,
          gg_approval: approvalDefault,
          gg_approval_by: null,
          gg_approval_at: null,
          gg_approval_notes: null,
          primary_document_id: null,
          payment_status: omieFalconStatus,
          original_amount: p.amount,
        });
      }
    }

    // 4. inserts em chunks — upsert evita falha se já existir a mesma chave
    // no banco por reenvio/duplo clique/importação concorrente.
    if (inserts.length) {
      const chunkSize = 500;
      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        const { error: insErr } = await admin
          .from("ap_entries")
          .upsert(chunk, { onConflict: "hotel_id,entry_key" });
        if (insErr) throw insErr;
      }
    }

    // 5. updates linha a linha (Supabase não tem bulk update por id)
    for (const u of updates) {
      const { id, ...rest } = u;
      const { error: updErr } = await admin.from("ap_entries").update(rest).eq("id", id);
      if (updErr) throw updErr;
    }

    // 6. arquiva os que sumiram do novo relatório
    //    Pagos vão para histórico (archived_reason = "paid_history") e os
    //    demais são arquivados normalmente.
    const toArchivePaid: string[] = [];
    const toArchiveOther: string[] = [];
    for (const e of existing ?? []) {
      if (updatedIds.has(e.id)) continue;
      if (seenKeys.has(e.entry_key) || e.archived_at) continue;
      if (e.payment_status === "pago") toArchivePaid.push(e.id);
      else toArchiveOther.push(e.id);
    }
    const nowIso = new Date().toISOString();
    const archiveChunk = 500;
    for (let i = 0; i < toArchivePaid.length; i += archiveChunk) {
      const chunk = toArchivePaid.slice(i, i + archiveChunk);
      await admin
        .from("ap_entries")
        .update({ archived_at: nowIso, archived_reason: "paid_history" })
        .in("id", chunk);
    }
    for (let i = 0; i < toArchiveOther.length; i += archiveChunk) {
      const chunk = toArchiveOther.slice(i, i + archiveChunk);
      await admin
        .from("ap_entries")
        .update({
          archived_at: nowIso,
          archived_reason: "omie_removed",
          archived_upload_id: uploadRow.id,
        })
        .in("id", chunk);
    }

    // 5. ZIP OMIE: salva docs extraídos
    let docsCreated = 0;
    if (extractedDocs.length) {
      for (const doc of extractedDocs) {
        const path = `${hotelId}/documents/${ts}-${sanitizeFileName(doc.name)}`;
        const { error: dErr } = await admin.storage
          .from("accounts-payable")
          .upload(path, doc.data, { contentType: doc.mime, upsert: true });
        if (dErr) continue;
        await admin.from("ap_documents").insert({
          hotel_id: hotelId,
          upload_id: uploadRow.id,
          file_name: doc.name,
          file_path: path,
          file_size: doc.data.byteLength,
          mime_type: doc.mime,
          uploaded_by: userId,
        });
        docsCreated++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      upload_id: uploadRow.id,
      entries: parsed.length,
      documents_extracted: docsCreated,
      skipped,
      updated: updates.length,
      inserted: inserts.length,
      archived_paid: toArchivePaid.length,
      omie_removed: toArchiveOther.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("parse-ap-report error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});