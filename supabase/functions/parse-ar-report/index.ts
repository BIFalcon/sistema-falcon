// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

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
function sanitizeFileName(name: string): string {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
}
type HotelMap = Map<string, string>; // lower(opera_property_name) → hotel_id

type ToInvoicePayload = {
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
};

type OpenFolioPayload = {
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
};

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

function mapToInvoiceEntries(entries: ToInvoicePayload[], hotelMap: HotelMap, uploadId: string) {
  const unmapped = new Set<string>();
  return {
    entries: entries.map((entry) => {
      const propRaw = normalize(entry.property_name_raw);
      const hotelId = resolveHotel(hotelMap, propRaw);
      if (!hotelId) unmapped.add(propRaw);

      return {
        upload_id: uploadId,
        hotel_id: hotelId,
        property_name_raw: propRaw,
        account_number: entry.account_number,
        account_name: entry.account_name,
        account_type: entry.account_type,
        invoice_number: entry.invoice_number,
        invoice_status: entry.invoice_status,
        transaction_date: entry.transaction_date,
        original_amount: entry.original_amount,
        amount: entry.amount,
        paid: entry.paid,
        ar_open: entry.ar_open,
        confirmation_number: entry.confirmation_number,
        reservation_status: entry.reservation_status,
        departure_date: entry.departure_date,
        entry_key: normalize(entry.entry_key),
      };
    }),
    unmapped: Array.from(unmapped),
  };
}

function mapOpenFolioEntries(entries: OpenFolioPayload[], hotelMap: HotelMap, uploadId: string) {
  const unmapped = new Set<string>();
  return {
    entries: entries.map((entry) => {
      const propRaw = normalize(entry.property_name_raw);
      const hotelId = resolveHotel(hotelMap, propRaw);
      if (!hotelId) unmapped.add(propRaw);

      return {
        upload_id: uploadId,
        hotel_id: hotelId,
        property_name_raw: propRaw,
        confirmation_number: entry.confirmation_number,
        reservation_status: entry.reservation_status,
        first_name: entry.first_name,
        last_name: entry.last_name,
        balance: entry.balance,
        arrival_date: entry.arrival_date,
        departure_date: entry.departure_date,
        extraction_date: entry.extraction_date,
        days_open: entry.days_open,
      };
    }),
    unmapped: Array.from(unmapped),
  };
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
    const rawEntries = String(form.get("entries") ?? "[]");
    if (!file || !["to_invoice", "open_folio"].includes(kind)) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedEntries: ToInvoicePayload[] | OpenFolioPayload[] = [];
    try {
      parsedEntries = JSON.parse(rawEntries);
      if (!Array.isArray(parsedEntries)) throw new Error("invalid_entries");
    } catch {
      return new Response(JSON.stringify({ error: "invalid_entries" }), {
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
    const reportPath = `${kind}/${ts}-${sanitizeFileName(file.name)}`;
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
      result = mapToInvoiceEntries(parsedEntries as ToInvoicePayload[], hotelMap, uploadRow.id);
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
      result = mapOpenFolioEntries(parsedEntries as OpenFolioPayload[], hotelMap, uploadRow.id);
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