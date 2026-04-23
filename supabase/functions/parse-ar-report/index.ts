// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  let s = String(v).trim().replace(/[R$\s]/g, "");
  if (s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function parseDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = "20" + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
function findCol(header: string[], ...candidates: string[]): number {
  const norm = header.map((h) => toAscii(normalize(h)));
  for (const c of candidates) {
    const i = norm.findIndex((h) => h === toAscii(c) || h.includes(toAscii(c)));
    if (i >= 0) return i;
  }
  return -1;
}

type HotelMap = Map<string, string>; // lower(opera_property_name) → hotel_id

async function loadHotelMap(admin: any): Promise<HotelMap> {
  const map: HotelMap = new Map();
  const { data } = await admin
    .from("hotels")
    .select("id, name, opera_property_name");
  for (const h of data ?? []) {
    if (h.opera_property_name) {
      map.set(toAscii(h.opera_property_name).trim(), h.id);
    }
    // fallback pelo próprio name
    if (h.name) {
      const k = toAscii(h.name).trim();
      if (!map.has(k)) map.set(k, h.id);
    }
  }
  return map;
}

function resolveHotel(map: HotelMap, propertyName: string): string | null {
  const k = toAscii(propertyName).trim();
  if (!k) return null;
  if (map.has(k)) return map.get(k)!;
  // tentativa contains
  for (const [key, id] of map.entries()) {
    if (key.includes(k) || k.includes(key)) return id;
  }
  return null;
}

function parseToInvoice(buf: ArrayBuffer, hotelMap: HotelMap, uploadId: string) {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (rows.length < 2) return { entries: [], unmapped: [] };
  const header = rows[0].map((h: any) => normalize(h));

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

  const entries: any[] = [];
  const unmapped = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const propRaw = normalize(row[cProp] ?? "");
    if (!propRaw) continue;
    if (toAscii(propRaw).startsWith("total")) continue;
    const hotelId = resolveHotel(hotelMap, propRaw);
    if (!hotelId) unmapped.add(propRaw);

    const txDate = parseDate(row[cTxDate]);
    const amount = parseNumber(row[cAmount]);
    const invNum = normalize(row[cInvNum] ?? "");
    const acctNum = normalize(row[cAcctNum] ?? "");
    const conf = normalize(row[cConf] ?? "");

    const keyBase = `${toAscii(propRaw)}|${invNum}|${conf}|${acctNum}|${txDate ?? ""}|${amount.toFixed(2)}`;
    const entry_key = keyBase.replace(/\s+/g, " ").slice(0, 240);

    entries.push({
      upload_id: uploadId,
      hotel_id: hotelId,
      property_name_raw: propRaw,
      account_number: acctNum || null,
      account_name: normalize(row[cAcctName] ?? "") || null,
      account_type: normalize(row[cAcctType] ?? "") || null,
      invoice_number: invNum || null,
      invoice_status: normalize(row[cInvStatus] ?? "") || null,
      transaction_date: txDate,
      original_amount: parseNumber(row[cOrig]) || null,
      amount: amount || null,
      paid: parseNumber(row[cPaid]) || null,
      ar_open: parseNumber(row[cArOpen]) || null,
      confirmation_number: conf || null,
      reservation_status: normalize(row[cResStatus] ?? "") || null,
      departure_date: parseDate(row[cDep]),
      entry_key,
      raw: { row, header },
    });
  }
  return { entries, unmapped: Array.from(unmapped) };
}

function parseOpenFolio(buf: ArrayBuffer, hotelMap: HotelMap, uploadId: string) {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  // linha 0 título, linha 1 vazia, linha 2 cabeçalho, 3+ dados
  if (rows.length < 4) return { entries: [], unmapped: [] };
  const header = (rows[2] ?? []).map((h: any) => normalize(h));

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

  const entries: any[] = [];
  const unmapped = new Set<string>();

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const propRaw = normalize(row[cProp] ?? "");
    if (!propRaw) continue;
    if (toAscii(propRaw).startsWith("total")) continue;
    const hotelId = resolveHotel(hotelMap, propRaw);
    if (!hotelId) unmapped.add(propRaw);

    entries.push({
      upload_id: uploadId,
      hotel_id: hotelId,
      property_name_raw: propRaw,
      confirmation_number: normalize(row[cConf] ?? "") || null,
      reservation_status: normalize(row[cResStatus] ?? "") || null,
      first_name: normalize(row[cFirst] ?? "") || null,
      last_name: normalize(row[cLast] ?? "") || null,
      balance: parseNumber(row[cBalance]) || null,
      arrival_date: parseDate(row[cArr]),
      departure_date: parseDate(row[cDep]),
      extraction_date: parseDate(row[cExtraction]),
      days_open: parseInt(String(row[cDays] ?? "").replace(/\D/g, "")) || null,
      raw: { row, header },
    });
  }
  return { entries, unmapped: Array.from(unmapped) };
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
    const kind = String(form.get("kind") ?? "") as "to_invoice" | "open_folio";
    if (!file || !["to_invoice", "open_folio"].includes(kind)) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isManager } = await admin.rpc("is_ar_manager", { _user_id: userId });
    if (!isManager) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuf = await file.arrayBuffer();
    const ts = Date.now();
    const reportPath = `${kind}/${ts}-${file.name}`;
    const { error: upErr } = await admin.storage
      .from("accounts-receivable")
      .upload(reportPath, new Uint8Array(arrayBuf), {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) throw upErr;

    // cria upload row
    const { data: uploadRow, error: uErr } = await admin
      .from("ar_uploads")
      .insert({
        kind,
        file_name: file.name,
        file_path: reportPath,
        file_size: arrayBuf.byteLength,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (uErr) throw uErr;

    const hotelMap = await loadHotelMap(admin);
    let result: { entries: any[]; unmapped: string[] };
    let inserted = 0;

    if (kind === "to_invoice") {
      result = parseToInvoice(arrayBuf, hotelMap, uploadRow.id);
      // upsert acumulativo por entry_key
      if (result.entries.length) {
        const chunkSize = 500;
        for (let i = 0; i < result.entries.length; i += chunkSize) {
          const chunk = result.entries.slice(i, i + chunkSize);
          const { error: insErr } = await admin
            .from("ar_to_invoice_entries")
            .upsert(chunk, { onConflict: "entry_key" });
          if (insErr) throw insErr;
          inserted += chunk.length;
        }
      }
    } else {
      result = parseOpenFolio(arrayBuf, hotelMap, uploadRow.id);
      // SUBSTITUIÇÃO completa
      await admin.from("ar_open_folio_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (result.entries.length) {
        const chunkSize = 500;
        for (let i = 0; i < result.entries.length; i += chunkSize) {
          const chunk = result.entries.slice(i, i + chunkSize);
          const { error: insErr } = await admin.from("ar_open_folio_entries").insert(chunk);
          if (insErr) throw insErr;
          inserted += chunk.length;
        }
      }
    }

    await admin
      .from("ar_uploads")
      .update({
        parsed_rows_count: inserted,
        unmapped_properties: result.unmapped,
      })
      .eq("id", uploadRow.id);

    // Dispara notificação Open Folio
    if (kind === "open_folio" && inserted > 0) {
      try {
        await admin.functions.invoke("notify-gg-open-folio", {
          body: { upload_id: uploadRow.id },
        });
      } catch (err) {
        console.error("notify-gg-open-folio invoke failed", err);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      upload_id: uploadRow.id,
      entries: inserted,
      unmapped_properties: result.unmapped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("parse-ar-report error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});