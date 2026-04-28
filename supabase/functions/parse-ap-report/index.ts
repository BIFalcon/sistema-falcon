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

function makeKey(supplier: string, doc: string | null, due: string | null, amount: number): string {
  const base = `${toAscii(supplier)}|${(doc ?? "").toString().trim()}|${due ?? ""}|${amount.toFixed(2)}`;
  return base.replace(/\s+/g, " ").slice(0, 240);
}

// Stable identity used to preserve user-attached documents across re-uploads,
// even when due_date or amount change. Uses ONLY supplier (normalized) +
// document number — matches the SQL backfill of `lookup_key`.
function makeLookupKey(supplier: string, doc: string | null): string {
  const sup = toAscii(supplier).replace(/\s+/g, " ").trim();
  const docNorm = (doc ?? "").toString().trim();
  return `${sup}|${docNorm}`.slice(0, 240);
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
    out.push({
      entry_key: makeKey(supplier, docNumber, due, amount),
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
    const i = norm.findIndex((h) => h.includes(toAscii(c)));
    if (i >= 0) return i;
  }
  return -1;
}

function parseOmieXlsx(buf: ArrayBuffer): ParsedEntry[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  // linha 0 título, linha 1 cabeçalho, linha 2 total geral, 3+ dados
  if (rows.length < 4) return [];
  const header = (rows[1] ?? []).map((h: any) => normalize(h));
  const colSit = findCol(header, "situacao");
  const colCnpj = findCol(header, "cnpj");
  const colSupplier = findCol(header, "razao social", "razao", "fornecedor");
  const colDue = findCol(header, "vencimento");
  const colCategory = findCol(header, "categoria");
  const colDoc = findCol(header, "nota fiscal", "documento");
  const colAmount = findCol(header, "a pagar", "valor", "receber");
  const colObs = findCol(header, "observacao", "observa");

  const out: ParsedEntry[] = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const supplier = normalize(row[colSupplier] ?? "");
    if (!supplier) continue;
    const lower = toAscii(supplier);
    if (lower.includes("total")) continue;
    const amountRaw = row[colAmount];
    const amount = Math.abs(parseNumber(amountRaw));
    if (amount <= 0) continue;
    const docNumber = normalize(row[colDoc] ?? "");
    const due = parseDate(row[colDue]);
    out.push({
      entry_key: makeKey(supplier, docNumber, due, amount),
      supplier,
      cnpj: normalize(row[colCnpj] ?? "") || null,
      document_number: docNumber || null,
      description: null,
      due_date: due,
      amount,
      payment_method: null,
      category: normalize(row[colCategory] ?? "") || null,
      observation: normalize(row[colObs] ?? "") || null,
      interest_fees: null,
      omie_situation: normalize(row[colSit] ?? "") || null,
      is_distribution: isDistributionEntry(normalize(row[colCategory] ?? ""), null),
      raw: { row, header },
    });
  }
  return out;
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

    const arrayBuf = await file.arrayBuffer();
    const lowerName = file.name.toLowerCase();

    let parsed: ParsedEntry[] = [];
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
      parsed = parseOmieXlsx(reportBuf);
    } else if (sourceSystem === "omie") {
      parsed = parseOmieXlsx(arrayBuf);
    } else {
      parsed = parseTotvsXls(arrayBuf);
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
    // 1. lê entries existentes (todos os campos que serão preservados)
    const { data: existing } = await admin
      .from("ap_entries")
      .select("id, entry_key, gg_approval, gg_approval_by, gg_approval_at, gg_approval_notes, primary_document_id, observation, archived_at")
      .eq("hotel_id", hotelId);
    const existingByKey = new Map<string, any>();
    for (const e of existing ?? []) {
      existingByKey.set(e.entry_key, e);
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
    const updates: any[] = [];
    const inserts: any[] = [];
    for (const p of parsed) {
      seenKeys.add(p.entry_key);
      const prev = existingByKey.get(p.entry_key);
      // OMIE: situação 'Agendado' implica aprovado quando ainda não havia aprovação
      let approvalDefault: "pending" | "approved" | "rejected" = "pending";
      if (sourceSystem === "omie" && p.omie_situation && toAscii(p.omie_situation).startsWith("agendado")) {
        approvalDefault = "approved";
      }
      const baseFields = {
        hotel_id: hotelId,
        upload_id: uploadRow.id,
        source_system: sourceSystem,
        entry_key: p.entry_key,
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
      };
      if (prev) {
        // Preserva: gg_approval*, primary_document_id, observation
        updates.push({
          id: prev.id,
          ...baseFields,
          // não sobrescreve aprovação/observação/documento
          observation: prev.observation ?? p.observation,
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
        });
      }
    }

    // 4. inserts em chunks
    if (inserts.length) {
      const chunkSize = 500;
      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        const { error: insErr } = await admin.from("ap_entries").insert(chunk);
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
    const toArchive: string[] = [];
    for (const e of existing ?? []) {
      if (!seenKeys.has(e.entry_key) && !e.archived_at) toArchive.push(e.id);
    }
    if (toArchive.length) {
      const nowIso = new Date().toISOString();
      const archiveChunk = 500;
      for (let i = 0; i < toArchive.length; i += archiveChunk) {
        const chunk = toArchive.slice(i, i + archiveChunk);
        await admin.from("ap_entries").update({ archived_at: nowIso }).in("id", chunk);
      }
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
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("parse-ap-report error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});