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
  company: string | null;
  travel_agent: string | null;
};

function makeOpenFolioKey(p: { confirmation_number: string | null; property_name_raw: string; arrival_date: string | null; departure_date: string | null }): string {
  return `${p.confirmation_number ?? ""}|${p.property_name_raw ?? ""}|${p.arrival_date ?? ""}|${p.departure_date ?? ""}`;
}

// Chave de deduplicação acumulativa para "A Faturar":
// property + transaction_date + confirmation_number + amount + account_number.
// Observação: `account_name` foi REMOVIDO da chave porque o relatório do Opera
// frequentemente troca o nome exibido para o mesmo `account_number` (ex.: razão
// social diferente em meses distintos), o que estava gerando falsos "novos"
// registros — mesma reserva, mesmo valor, mesma data, mesmo CNPJ, só com nome
// grafado diferente. `account_number` é o identificador estável.
function makeDedupKey(e: {
  hotel_id: string | null;
  property_name_raw?: string | null;
  transaction_date: string | null;
  confirmation_number: string | null;
  amount: number | string | null;
  account_name: string | null;
  account_number: string | null;
}): string {
  const amt = e.amount == null || e.amount === "" ? "" : Number(e.amount).toFixed(2);
  return [
    e.hotel_id ?? toAscii(normalize(e.property_name_raw)),
    e.transaction_date ?? "",
    toAscii(normalize(e.confirmation_number)),
    amt,
    toAscii(normalize(e.account_number)),
  ].join("|");
}

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
        company: entry.company ?? null,
        travel_agent: entry.travel_agent ?? null,
        entry_key: makeOpenFolioKey({
          confirmation_number: entry.confirmation_number,
          property_name_raw: propRaw,
          arrival_date: entry.arrival_date,
          departure_date: entry.departure_date,
        }),
        archived_at: null,
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
      // Acumulativo + dedup: só insere o que ainda NÃO existe. Nunca sobrescreve
      // registros já presentes (preserva pago, documentos, notas, status, etc).
      // Chave de match: property + transaction_date + confirmation + amount +
      // account_name + account_number — exatamente como solicitado.
      if (result.entries.length) {
        // 1) Dedup interno do arquivo (linhas idênticas no mesmo upload).
        const incomingByKey = new Map<string, any>();
        for (const e of result.entries) {
          const k = makeDedupKey(e);
          if (!incomingByKey.has(k)) incomingByKey.set(k, e);
        }
        const incomingDupes = result.entries.length - incomingByKey.size;

        // 2) Carrega chaves existentes nos hotéis afetados.
        const hotelIds = Array.from(
          new Set(
            result.entries
              .map((e: any) => e.hotel_id)
              .filter((id: string | null): id is string => !!id),
          ),
        );
        const existingKeys = new Set<string>();
        if (hotelIds.length) {
          const pageSize = 1000;
          let from = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { data: rows, error: exErr } = await admin
              .from("ar_to_invoice_entries")
              .select(
                "hotel_id, transaction_date, confirmation_number, amount, account_number",
              )
              .in("hotel_id", hotelIds)
              .range(from, from + pageSize - 1);
            if (exErr) throw exErr;
            const list = rows ?? [];
            for (const r of list) existingKeys.add(makeDedupKey(r as any));
            if (list.length < pageSize) break;
            from += pageSize;
          }
        }

        // 3) Filtra e gera entry_key novo (com account_name) para evitar
        //    colisão com o unique constraint no caso de account_name divergente.
        const toInsert: any[] = [];
        let alreadyExists = 0;
        for (const [k, e] of incomingByKey) {
          if (existingKeys.has(k)) {
            alreadyExists += 1;
            continue;
          }
          toInsert.push({ ...e, entry_key: k.slice(0, 240) });
        }

        if (toInsert.length) {
          const chunkSize = 500;
          for (let i = 0; i < toInsert.length; i += chunkSize) {
            const chunk = toInsert.slice(i, i + chunkSize);
            const { error: insErr } = await admin
              .from("ar_to_invoice_entries")
              .insert(chunk);
            if (insErr) throw insErr;
            inserted += chunk.length;
          }
        }

        (result as any).skipped_existing = alreadyExists;
        (result as any).skipped_duplicate_in_file = incomingDupes;
        (result as any).total_rows = result.entries.length;
      }
    } else {
      result = mapOpenFolioEntries(parsedEntries as OpenFolioPayload[], hotelMap, uploadRow.id);
      // Upsert preservando justificativas/datas (entry_key composto).
      const withKey = result.entries.filter((e: any) => e.confirmation_number);
      const noKey = result.entries.filter((e: any) => !e.confirmation_number);
      // Dedup within file by entry_key to avoid Postgres
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const dedupMap = new Map<string, any>();
      for (const e of withKey) dedupMap.set(e.entry_key, e);
      const withKeyDedup = Array.from(dedupMap.values());
      const seenKeys = new Set<string>(withKeyDedup.map((e: any) => e.entry_key));
      if (withKeyDedup.length) {
        const chunkSize = 500;
        for (let i = 0; i < withKeyDedup.length; i += chunkSize) {
          const chunk = withKeyDedup.slice(i, i + chunkSize);
          const { error: insErr } = await admin
            .from("ar_open_folio_entries")
            .upsert(chunk, { onConflict: "entry_key" });
          if (insErr) throw insErr;
          inserted += chunk.length;
        }
      }
      if (noKey.length) {
        // Linhas sem confirmation_number não têm como ser correlacionadas — limpa antigas e insere novas.
        await admin.from("ar_open_folio_entries").delete().is("confirmation_number", null);
        const chunkSize = 500;
        for (let i = 0; i < noKey.length; i += chunkSize) {
          const chunk = noKey.slice(i, i + chunkSize);
          const { error: insErr } = await admin.from("ar_open_folio_entries").insert(chunk);
          if (insErr) throw insErr;
          inserted += chunk.length;
        }
      }
      // Arquiva (não deleta) os registros que sumiram do novo upload — preserva
      // histórico e justificativas. Paginação manual porque o PostgREST limita
      // a 1000 linhas por request — sem isso, hotéis com >1k folios deixavam
      // registros antigos visíveis mesmo após upload novo.
      const nowIso = new Date().toISOString();
      const toArchive: string[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: pageRows, error: pageErr } = await admin
          .from("ar_open_folio_entries")
          .select("id, entry_key, archived_at, confirmation_number")
          .is("archived_at", null)
          .range(from, from + pageSize - 1);
        if (pageErr) throw pageErr;
        const rows = pageRows ?? [];
        for (const f of rows) {
          if (!f.confirmation_number || !f.entry_key) continue;
          if (!seenKeys.has(f.entry_key)) toArchive.push(f.id);
        }
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      if (toArchive.length) {
        const archiveChunk = 500;
        for (let i = 0; i < toArchive.length; i += archiveChunk) {
          const chunk = toArchive.slice(i, i + archiveChunk);
          await admin.from("ar_open_folio_entries").update({ archived_at: nowIso }).in("id", chunk);
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

    // Dispara notificação A Faturar — confirmação por registro pelo GG
    if (kind === "to_invoice" && inserted > 0) {
      try {
        await admin.functions.invoke("notify-gg-to-invoice", {
          body: { upload_id: uploadRow.id },
        });
      } catch (err) {
        console.error("notify-gg-to-invoice invoke failed", err);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      upload_id: uploadRow.id,
      entries: inserted,
      unmapped_properties: result.unmapped,
      total_rows: (result as any).total_rows ?? inserted,
      skipped_existing: (result as any).skipped_existing ?? 0,
      skipped_duplicate_in_file: (result as any).skipped_duplicate_in_file ?? 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("parse-ar-report error", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});