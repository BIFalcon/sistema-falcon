// Edge function: usa Lovable AI Gateway para validar um documento (PDF/imagem)
// vinculado a um lançamento de Contas a Pagar.
// Retorna o resultado da validação (e persiste em ap_documents).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "google/gemini-2.5-flash";

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  // Deno provides btoa with binary string
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const documentId = String(body.document_id ?? "");
    const entryId = String(body.entry_id ?? "");
    if (!documentId || !entryId) return json({ error: "missing_fields" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const [{ data: doc }, { data: entry }] = await Promise.all([
      admin.from("ap_documents").select("*").eq("id", documentId).maybeSingle(),
      admin.from("ap_entries").select("*").eq("id", entryId).maybeSingle(),
    ]);
    if (!doc || !entry) return json({ error: "not_found" }, 404);

    // Authorization: caller must have access to this entry's hotel
    const userId = userData.user.id;
    const allowed = await admin.rpc("is_hotel_allowed", {
      _user_id: userId,
      _hotel_id: entry.hotel_id,
    });
    if (allowed.error || allowed.data !== true) {
      return json({ error: "forbidden" }, 403);
    }

    // Match ap_documents RLS: only AP managers (or master) can write.
    const [{ data: isApManager }, { data: isMaster }] = await Promise.all([
      admin.rpc("is_ap_manager", { _user_id: userId }),
      admin.rpc("is_master", { _user_id: userId }),
    ]);
    if (!isApManager && !isMaster) {
      return json({ error: "forbidden" }, 403);
    }

    if (!aiKey) {
      // Sem IA configurada — registra como "pending" e devolve aviso
      await admin.from("ap_documents").update({
        validation_status: "pending",
        validation_details: { reason: "no_ai_key" },
        validated_at: new Date().toISOString(),
      }).eq("id", documentId);
      return json({ ok: true, validation_status: "pending", reason: "no_ai_key" });
    }

    // Baixa o arquivo do storage
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from("accounts-payable")
      .download(doc.file_path);
    if (dlErr || !fileBlob) return json({ error: "download_failed" }, 500);

    const mime = doc.mime_type || fileBlob.type || "application/octet-stream";
    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf" || (doc.file_name ?? "").toLowerCase().endsWith(".pdf");

    // Lovable AI (Gemini) aceita imagens via image_url (data URL).
    // PDFs nem sempre são aceitos diretamente — neste caso enviamos apenas
    // metadata e marcamos como 'unreadable' caso não seja imagem.
    if (!isImage && !isPdf) {
      await admin.from("ap_documents").update({
        validation_status: "unreadable",
        validation_details: { reason: "unsupported_mime", mime },
        validated_at: new Date().toISOString(),
      }).eq("id", documentId);
      return json({ ok: true, validation_status: "unreadable", reason: "unsupported_mime" });
    }

    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const base64 = bytesToBase64(buf);
    const dataUrl = `data:${mime};base64,${base64}`;

    const sysPrompt = `Você é um auditor de documentos fiscais brasileiros (NF-e, NFS-e, boletos, recibos).
Sua tarefa é EXTRAIR do documento (imagem/PDF) os campos abaixo e devolver SOMENTE JSON, sem comentários:

{
  "doc_type": "nfe" | "nfse" | "boleto" | "recibo" | "outro",
  "is_fiscal_document": true/false,
  "amount": número (valor total do documento em reais, sem moeda) | null,
  "supplier_cnpj": "string só dígitos" | null,
  "supplier_name": string | null,
  "document_number": string | null,
  "issue_date": "YYYY-MM-DD" | null,
  "notes": string curta opcional
}

Regras: número em ponto decimal (ex.: 1234.56). CNPJ apenas dígitos. Se não conseguir ler, use null.`;

    const userText = `Lançamento esperado:
- Fornecedor: ${entry.supplier}
- CNPJ: ${entry.cnpj ?? "(não informado)"}
- Nº documento: ${entry.document_number ?? "(não informado)"}
- Valor: ${Number(entry.amount).toFixed(2)}

Extraia os dados do documento anexado.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sysPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (aiRes.status === 429) return json({ error: "rate_limited" }, 429);
    if (aiRes.status === 402) return json({ error: "ai_credits_exhausted" }, 402);
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, txt);
      await admin.from("ap_documents").update({
        validation_status: "unreadable",
        validation_details: { reason: "ai_error", status: aiRes.status, text: txt.slice(0, 300) },
        validated_at: new Date().toISOString(),
      }).eq("id", documentId);
      return json({ ok: true, validation_status: "unreadable", reason: "ai_error" });
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content;
    let parsed: any = {};
    try { parsed = JSON.parse(content ?? "{}"); } catch { parsed = {}; }

    // Comparações
    const expectedAmount = Number(entry.amount);
    const docAmount = parsed.amount != null ? Number(parsed.amount) : null;
    const amountDiff = docAmount != null ? Math.abs(docAmount - expectedAmount) : null;
    const amountOk = amountDiff != null && amountDiff <= Math.max(0.01, expectedAmount * 0.01); // 1% tolerância

    const expectedCnpj = onlyDigits(entry.cnpj);
    const docCnpj = onlyDigits(parsed.supplier_cnpj);
    const cnpjOk = expectedCnpj && docCnpj ? expectedCnpj === docCnpj : null; // null = não foi possível comparar

    const docType = String(parsed.doc_type ?? "outro").toLowerCase();
    const isFiscal = parsed.is_fiscal_document === true || ["nfe", "nfse"].includes(docType);

    // Status final
    const checks = {
      amount: { ok: amountOk, expected: expectedAmount, found: docAmount, diff: amountDiff },
      cnpj:   { ok: cnpjOk,   expected: expectedCnpj || null, found: docCnpj || null },
      fiscal: { ok: isFiscal, doc_type: docType },
    };
    const hasDivergence =
      amountOk === false ||
      cnpjOk === false ||
      isFiscal === false;

    const status = hasDivergence ? "divergence" : "ok";

    await admin.from("ap_documents").update({
      doc_cnpj: docCnpj || null,
      doc_type: docType,
      nf_amount: docAmount,
      validation_status: status,
      validation_details: { checks, ai: parsed },
      validated_at: new Date().toISOString(),
    }).eq("id", documentId);

    return json({ ok: true, validation_status: status, checks, ai: parsed });
  } catch (err: any) {
    console.error("validate-ap-document error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
