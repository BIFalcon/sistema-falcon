import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-flash";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseDateBR(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function digitsOnly(value: unknown): string | null {
  if (!value) return null;
  const d = String(value).replace(/\D+/g, "");
  return d || null;
}

async function callAi(aiKey: string, kind: "nota" | "boleto", dataUrl: string) {
  const sys = kind === "boleto"
    ? `Você lê BOLETOS bancários brasileiros (qualquer banco). Devolva SOMENTE JSON:
{
  "boleto_number": "string com o NÚMERO DO DOCUMENTO/título (Núm. do documento, Nosso Número ou Número do título) | null",
  "due_date": "YYYY-MM-DD (campo Vencimento) | null",
  "amount": número decimal (Valor do Documento) | null,
  "barcode": "linha digitável (com ou sem pontos) | null"
}
Sem comentários. Datas em ISO. Se não conseguir ler, use null.`
    : `Você lê NOTAS FISCAIS brasileiras (NF-e, NFS-e, recibo). Devolva SOMENTE JSON:
{
  "nota_number": "número da nota fiscal (apenas o número) | null",
  "issue_date": "YYYY-MM-DD (data de emissão) | null",
  "amount": número decimal (valor total) | null
}
Sem comentários. Datas em ISO. Se não conseguir ler, use null.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: `Extraia os campos do ${kind === "boleto" ? "boleto" : "nota fiscal"} em anexo.` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { error: `ai_${res.status}`, text: txt.slice(0, 300) };
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  try { return { parsed: JSON.parse(content ?? "{}") }; }
  catch { return { error: "parse_error", text: String(content).slice(0, 300) }; }
}

async function fetchFileAsDataUrl(admin: any, path: string): Promise<{ dataUrl: string } | { error: string }> {
  if (/^https?:\/\//i.test(path)) {
    const r = await fetch(path);
    if (!r.ok) return { error: `download_${r.status}` };
    const mime = r.headers.get("content-type") ?? "application/octet-stream";
    const buf = new Uint8Array(await r.arrayBuffer());
    return { dataUrl: `data:${mime};base64,${bytesToBase64(buf)}` };
  }
  const { data, error } = await admin.storage.from("invoices").download(path);
  if (error || !data) return { error: error?.message ?? "download_failed" };
  const mime = (data as Blob).type || "application/pdf";
  const buf = new Uint8Array(await (data as Blob).arrayBuffer());
  return { dataUrl: `data:${mime};base64,${bytesToBase64(buf)}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const aiKey = Deno.env.get("LOVABLE_API_KEY");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const entryId: string = body?.entry_id;
    const notaPath: string | null = body?.nota_path ?? null;
    const boletoPath: string | null = body?.boleto_path ?? null;
    if (!entryId) return json({ error: "missing_entry_id" }, 400);
    if (!notaPath && !boletoPath) return json({ error: "no_files" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: entry, error: entryErr } = await admin
      .from("ar_to_invoice_entries").select("id,hotel_id").eq("id", entryId).maybeSingle();
    if (entryErr || !entry) return json({ error: "entry_not_found" }, 404);

    const { data: allowed } = await admin.rpc("is_hotel_allowed", { _user_id: user.id, _hotel_id: entry.hotel_id });
    if (!allowed) return json({ error: "forbidden" }, 403);

    if (!aiKey) {
      await admin.from("ar_to_invoice_entries").update({
        doc_extraction_status: "pending",
        doc_extraction_details: { reason: "no_ai_key" },
      }).eq("id", entryId);
      return json({ ok: true, status: "pending" });
    }

    const update: Record<string, unknown> = {};
    const details: Record<string, unknown> = {};

    if (notaPath) {
      const f = await fetchFileAsDataUrl(admin, notaPath);
      if ("error" in f) {
        details.nota = { error: f.error };
      } else {
        const r = await callAi(aiKey, "nota", f.dataUrl);
        if ("error" in r) details.nota = r;
        else {
          details.nota = r.parsed;
          const num = digitsOnly(r.parsed?.nota_number);
          if (num) update.nota_number = num;
        }
      }
    }

    if (boletoPath) {
      const f = await fetchFileAsDataUrl(admin, boletoPath);
      if ("error" in f) {
        details.boleto = { error: f.error };
      } else {
        const r = await callAi(aiKey, "boleto", f.dataUrl);
        if ("error" in r) details.boleto = r;
        else {
          details.boleto = r.parsed;
          const num = digitsOnly(r.parsed?.boleto_number);
          if (num) update.boleto_number = num;
          const due = parseDateBR(r.parsed?.due_date);
          if (due) update.boleto_due_date = due;
        }
      }
    }

    update.doc_extraction_status = "ok";
    update.doc_extraction_details = details;

    const { error: updErr } = await admin.from("ar_to_invoice_entries").update(update).eq("id", entryId);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, extracted: update });
  } catch (err) {
    console.error("extract-ar-document error", err);
    return json({ error: (err as Error).message ?? "error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}