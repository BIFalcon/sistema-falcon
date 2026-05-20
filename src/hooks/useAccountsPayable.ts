import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import JSZip from "jszip";

export type FinancialSystem = "totvs" | "omie";
export type ApApproval = "pending" | "approved" | "rejected";
export type ApPaymentStatus =
  | "em_aprovacao" // GG aprovou no OMIE — aguardando autorização do financeiro
  | "autorizado"   // coordenadora autorizou para pagamento
  | "agendado"     // agendado (unifica antigo "inserido")
  | "pago";        // pago

export interface ApUpload {
  id: string;
  hotel_id: string;
  kind: "report" | "documents";
  source_system: FinancialSystem;
  file_name: string;
  file_path: string;
  file_size: number | null;
  uploaded_by: string;
  uploaded_at: string;
  parsed_entries_count: number | null;
  parse_error: string | null;
}

export interface ApEntry {
  id: string;
  hotel_id: string;
  upload_id: string;
  source_system: FinancialSystem;
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
  gg_approval: ApApproval;
  gg_approval_by: string | null;
  gg_approval_at: string | null;
  gg_approval_notes: string | null;
  primary_document_id: string | null;
  is_distribution: boolean;
  archived_at: string | null;
  payment_status: ApPaymentStatus;
  payment_marked_by: string | null;
  payment_marked_at: string | null;
  payment_paid_at: string | null;
  scheduled_date: string | null;
  bank_account: string | null;
  hotel_cnpj: string | null;
  paid_interest: number | null;
  paid_amount: number | null;
  original_amount: number | null;
  is_group?: boolean | null;
  grouped_ids?: string[] | null;
}

export interface ApBankBalance {
  id: string;
  hotel_id: string;
  balance_date: string;
  amount: number;
  informed_by: string;
  updated_at: string;
  bank_name: string;
}

export interface ApDocument {
  id: string;
  hotel_id: string;
  upload_id: string | null;
  entry_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  nf_amount: number | null;
  uploaded_by: string;
  uploaded_at: string;
  doc_cnpj?: string | null;
  doc_type?: string | null;
  validation_status?: "ok" | "divergence" | "unreadable" | "pending" | null;
  validation_details?: Record<string, unknown> | null;
  validated_at?: string | null;
}

export function useApDocuments(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-documents", hotelId],
    queryFn: async (): Promise<ApDocument[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ap_documents")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApDocument[];
    },
  });
}

export async function uploadApDocuments(input: {
  hotelId: string;
  files: File[];
  userId: string;
}): Promise<number> {
  const ts = Date.now();
  let count = 0;

  // 1) Extrair ZIPs no client e expandir lista de arquivos.
  const expanded: { name: string; blob: Blob; mime: string; size: number }[] = [];
  for (const file of input.files) {
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";
    if (isZip) {
      try {
        const zip = await JSZip.loadAsync(file);
        const inner = Object.values(zip.files).filter((z) => !z.dir);
        for (const z of inner) {
          const lower = z.name.toLowerCase();
          // Aceita PDFs e outros docs comuns dentro do ZIP
          if (!/\.(pdf|ofx|xml|png|jpe?g)$/i.test(lower)) continue;
          const blob = await z.async("blob");
          const baseName = z.name.split("/").pop() || z.name;
          const mime = lower.endsWith(".pdf")
            ? "application/pdf"
            : lower.endsWith(".png")
            ? "image/png"
            : /\.jpe?g$/.test(lower)
            ? "image/jpeg"
            : lower.endsWith(".xml")
            ? "application/xml"
            : lower.endsWith(".ofx")
            ? "application/octet-stream"
            : "application/octet-stream";
          expanded.push({ name: baseName, blob, mime, size: blob.size });
        }
      } catch (err) {
        throw new Error(`Falha ao extrair ZIP "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      expanded.push({ name: file.name, blob: file, mime: file.type || "application/octet-stream", size: file.size });
    }
  }

  // 2) Upload concorrente em lotes para acelerar muitos arquivos.
  const CONCURRENCY = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < expanded.length) {
      const i = cursor++;
      const f = expanded[i];
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${input.hotelId}/documents/${ts}-${i}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("accounts-payable")
        .upload(path, f.blob, { contentType: f.mime, upsert: true });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("ap_documents").insert({
        hotel_id: input.hotelId,
        file_name: f.name,
        file_path: path,
        file_size: f.size,
        mime_type: f.mime,
        uploaded_by: input.userId,
      });
      if (insErr) throw insErr;
      count++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, expanded.length) }, worker));
  return count;
}

export function useLinkDocumentToEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      entryId: string;
      documentId: string | null;
      nfAmount?: number | null;
    }) => {
      // limpar vínculo anterior do entry
      const { data: entry } = await supabase
        .from("ap_entries")
        .select("primary_document_id")
        .eq("id", input.entryId)
        .single();
      if (entry?.primary_document_id && entry.primary_document_id !== input.documentId) {
        await supabase
          .from("ap_documents")
          .update({ entry_id: null })
          .eq("id", entry.primary_document_id);
      }
      // novo vínculo
      if (input.documentId) {
        const { error } = await supabase
          .from("ap_documents")
          .update({
            entry_id: input.entryId,
            ...(input.nfAmount !== undefined ? { nf_amount: input.nfAmount } : {}),
          })
          .eq("id", input.documentId);
        if (error) throw error;
      }
      const { error: e2 } = await supabase
        .from("ap_entries")
        .update({ primary_document_id: input.documentId })
        .eq("id", input.entryId);
      if (e2) throw e2;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-documents", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

/**
 * Anexa um documento adicional ao lançamento (sem alterar o principal).
 * Use isto quando vincular ex.: NF + boleto a um mesmo lançamento.
 */
export function useAttachDocumentToEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      entryId: string;
      documentId: string;
      nfAmount?: number | null;
      makePrimary?: boolean;
    }) => {
      const { error } = await supabase
        .from("ap_documents")
        .update({
          entry_id: input.entryId,
          ...(input.nfAmount !== undefined ? { nf_amount: input.nfAmount } : {}),
        })
        .eq("id", input.documentId);
      if (error) throw error;
      // Define como principal se for o primeiro ou se solicitado.
      const { data: existing } = await supabase
        .from("ap_entries")
        .select("primary_document_id")
        .eq("id", input.entryId)
        .single();
      if (input.makePrimary || !existing?.primary_document_id) {
        await supabase
          .from("ap_entries")
          .update({ primary_document_id: input.documentId })
          .eq("id", input.entryId);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-documents", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

/** Remove o vínculo de UM documento (sem deletar o arquivo). */
export function useDetachDocumentFromEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; entryId: string; documentId: string }) => {
      const { error } = await supabase
        .from("ap_documents")
        .update({ entry_id: null })
        .eq("id", input.documentId);
      if (error) throw error;
      // Se era o principal, escolhe outro doc remanescente como principal.
      const { data: entry } = await supabase
        .from("ap_entries")
        .select("primary_document_id")
        .eq("id", input.entryId)
        .single();
      if (entry?.primary_document_id === input.documentId) {
        const { data: others } = await supabase
          .from("ap_documents")
          .select("id")
          .eq("entry_id", input.entryId)
          .limit(1);
        await supabase
          .from("ap_entries")
          .update({ primary_document_id: others?.[0]?.id ?? null })
          .eq("id", input.entryId);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-documents", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

/** Marca um documento como principal entre os já vinculados ao lançamento. */
export function useSetPrimaryDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; entryId: string; documentId: string }) => {
      const { error } = await supabase
        .from("ap_entries")
        .update({ primary_document_id: input.documentId })
        .eq("id", input.entryId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; documentId: string; filePath: string }) => {
      await supabase.storage.from("accounts-payable").remove([input.filePath]);
      const { error } = await supabase.from("ap_documents").delete().eq("id", input.documentId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-documents", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

export async function getDocumentSignedUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("accounts-payable")
    .createSignedUrl(filePath, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function notifyGgPendencies(input: {
  hotelId: string;
  entryIds: string[];
  dueFrom?: string | null;
  dueTo?: string | null;
  extraEmails?: string[];
  message?: string | null;
}): Promise<{ ok: boolean; sent?: number; recipients?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("notify-gg-ap", {
    body: {
      hotel_id: input.hotelId,
      entry_ids: input.entryIds,
      due_from: input.dueFrom ?? null,
      due_to: input.dueTo ?? null,
      extra_emails: input.extraEmails ?? [],
      message: input.message ?? null,
    },
  });
  if (error) throw error;
  return data as { ok: boolean; sent?: number; recipients?: number; error?: string };
}

/** Dispara validação automática (IA) de um documento contra o lançamento. */
export async function validateApDocument(input: {
  documentId: string;
  entryId: string;
}): Promise<{ ok: boolean; validation_status?: string; checks?: any }> {
  const { data, error } = await supabase.functions.invoke("validate-ap-document", {
    body: { document_id: input.documentId, entry_id: input.entryId },
  });
  if (error) throw error;
  return data as { ok: boolean; validation_status?: string; checks?: unknown };
}

export function useLatestApUpload(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-upload", hotelId],
    queryFn: async (): Promise<ApUpload | null> => {
      if (!hotelId) return null;
      const { data, error } = await supabase
        .from("ap_uploads")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("kind", "report")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ApUpload | null;
    },
  });
}

export function useApEntries(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-entries", hotelId],
    queryFn: async (): Promise<ApEntry[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ap_entries")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as ApEntry[];
    },
  });
}

/** Busca lançamentos AP de todos os hotéis acessíveis ao usuário (RLS aplica). */
export function useAllApEntries(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["ap-entries-all"],
    queryFn: async (): Promise<ApEntry[]> => {
      const { data, error } = await supabase
        .from("ap_entries")
        .select("*")
        .is("archived_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as ApEntry[];
    },
  });
}

/** Saldos bancários do dia para todos os hotéis acessíveis. */
export function useAllTodayBankBalances(enabled = true) {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    enabled,
    queryKey: ["ap-balances-all", today],
    queryFn: async (): Promise<ApBankBalance[]> => {
      const { data, error } = await supabase
        .from("ap_bank_balance")
        .select("*")
        .eq("balance_date", today);
      if (error) throw error;
      return (data ?? []) as ApBankBalance[];
    },
  });
}

export function useTodayBankBalance(hotelId: string | null, bankName: "itau" | "santander" = "itau") {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-balance", hotelId, today, bankName],
    queryFn: async (): Promise<ApBankBalance | null> => {
      if (!hotelId) return null;
      const { data, error } = await supabase
        .from("ap_bank_balance")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("balance_date", today)
        .eq("bank_name", bankName)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ApBankBalance | null;
    },
  });
}

export function useUpsertBankBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      amount: number;
      userId: string;
      bankName?: "itau" | "santander";
    }) => {
      const today = new Date().toISOString().slice(0, 10);
      const bankName = input.bankName ?? "itau";
      const { error } = await supabase
        .from("ap_bank_balance")
        .upsert(
          {
            hotel_id: input.hotelId,
            balance_date: today,
            bank_name: bankName,
            amount: input.amount,
            informed_by: input.userId,
          },
          { onConflict: "hotel_id,balance_date,bank_name" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-balance", v.hotelId] });
    },
  });
}

export function useSetEntryApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entryId: string;
      hotelId: string;
      approval: ApApproval;
      userId: string;
      notes?: string;
    }) => {
      const { error } = await supabase
        .from("ap_entries")
        .update({
          gg_approval: input.approval,
          gg_approval_by: input.userId,
          gg_approval_at: new Date().toISOString(),
          gg_approval_notes: input.notes ?? null,
        })
        .eq("id", input.entryId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
    },
  });
}

export async function uploadApReport(input: {
  hotelId: string;
  sourceSystem: FinancialSystem;
  file: File;
}): Promise<{ entries: number; documents_extracted: number; skipped?: { duplicate_entry?: number } }> {
  const form = new FormData();
  form.append("hotel_id", input.hotelId);
  form.append("source_system", input.sourceSystem);
  form.append("file", input.file);
  const { data, error } = await supabase.functions.invoke("parse-ap-report", {
    body: form,
  });
  if (error) throw error;
  const result = data as { entries: number; documents_extracted: number; skipped?: { duplicate_entry?: number }; error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

/** Atualiza em lote o status de pagamento dos lançamentos. */
export function useSetEntryPaymentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      entryIds: string[];
      status: ApPaymentStatus;
      scheduledDate?: string | null;
      paidInterest?: number | null;
      paidAmount?: number | null;
    }) => {
      if (input.entryIds.length === 0) return 0;
      const update: Record<string, unknown> = { payment_status: input.status };
      if (input.scheduledDate !== undefined) update.scheduled_date = input.scheduledDate;
      if (input.paidInterest !== undefined) update.paid_interest = input.paidInterest;
      if (input.paidAmount !== undefined) update.paid_amount = input.paidAmount;
      const { error } = await supabase
        .from("ap_entries")
        .update(update as never)
        .in("id", input.entryIds);
      if (error) throw error;
      return input.entryIds.length;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
    },
  });
}

// ── Cartão a receber ──────────────────────────────────────────────────────
export interface ApCardReceivable {
  id: string;
  hotel_id: string;
  amount: number;
  date_from: string;
  date_to: string;
  informed_by: string;
  created_at: string;
}

export function useCardReceivable(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-card-receivable", hotelId],
    queryFn: async (): Promise<ApCardReceivable[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ap_card_receivable")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("date_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApCardReceivable[];
    },
  });
}

export function useUpsertCardReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      amount: number;
      dateFrom: string;
      dateTo: string;
      userId: string;
    }) => {
      const { error } = await supabase
        .from("ap_card_receivable")
        .upsert(
          {
            hotel_id: input.hotelId,
            amount: input.amount,
            date_from: input.dateFrom,
            date_to: input.dateTo,
            informed_by: input.userId,
          },
          { onConflict: "hotel_id,date_from,date_to" },
        );
      if (error) throw error;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-card-receivable", v.hotelId] });
    },
  });
}

// ── Histórico de notificações ─────────────────────────────────────────────
export interface ApNotificationLog {
  id: string;
  hotel_id: string;
  sent_by: string;
  sent_at: string;
  entry_ids: string[];
  recipient_emails: string[];
  message_text: string | null;
  entries_snapshot: unknown[];
}

export function useApNotificationLog(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-notification-log", hotelId],
    queryFn: async (): Promise<ApNotificationLog[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ap_notification_log")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("sent_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ApNotificationLog[];
    },
  });
}

export function useSaveNotificationLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      sentBy: string;
      entryIds: string[];
      recipientEmails: string[];
      messageText: string;
      entriesSnapshot: unknown[];
    }) => {
      const { error } = await supabase
        .from("ap_notification_log")
        .insert([{
          hotel_id: input.hotelId,
          sent_by: input.sentBy,
          entry_ids: input.entryIds,
          recipient_emails: input.recipientEmails,
          message_text: input.messageText,
          entries_snapshot: input.entriesSnapshot,
        } as never]);
      if (error) throw error;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-notification-log", v.hotelId] });
    },
  });
}

/** Atualiza apenas a observação de um lançamento. */
export function useUpdateEntryObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; hotelId: string; observation: string }) => {
      const { error } = await supabase
        .from("ap_entries")
        .update({ observation: input.observation } as never)
        .eq("id", input.entryId);
      if (error) throw error;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
    },
  });
}

export function useUpdateEntryCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; hotelId: string; category: string | null }) => {
      const { error } = await supabase
        .from("ap_entries")
        .update({ category: input.category } as never)
        .eq("id", input.entryId);
      if (error) throw error;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
    },
  });
}

/**
 * Agrupa múltiplos lançamentos em um único novo lançamento com categoria personalizada.
 * - Cria um novo `ap_entries` com is_group = true, grouped_ids = [ids], soma dos valores
 * - Arquiva (archived_at = now()) os lançamentos originais
 */
export function useGroupEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      entryIds: string[];
      categoryName: string;
    }) => {
      if (input.entryIds.length < 2) {
        throw new Error("Selecione ao menos 2 lançamentos para agrupar.");
      }

      // Busca os lançamentos originais
      const { data: originals, error: fetchErr } = await supabase
        .from("ap_entries")
        .select("*")
        .in("id", input.entryIds);
      if (fetchErr) throw fetchErr;
      if (!originals || originals.length === 0) {
        throw new Error("Lançamentos não encontrados.");
      }

      const first = originals[0] as unknown as ApEntry;
      const total = originals.reduce(
        (s, e) => s + Number((e as { amount: number }).amount ?? 0),
        0,
      );
      // Vencimento: usa a maior data de vencimento entre os selecionados
      const dueDates = originals
        .map((e) => (e as { due_date: string | null }).due_date)
        .filter((d): d is string => !!d)
        .sort();
      const dueDate = dueDates[dueDates.length - 1] ?? null;

      const newEntry = {
        hotel_id: input.hotelId,
        upload_id: first.upload_id,
        source_system: first.source_system,
        entry_key: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        supplier: first.supplier, // mantém o nome do fornecedor original
        cnpj: null,
        document_number: null,
        description: `Agrupamento de ${originals.length} lançamentos`,
        due_date: dueDate,
        amount: total,
        original_amount: total,
        category: input.categoryName,
        is_group: true,
        grouped_ids: input.entryIds,
        gg_approval: "approved" as ApApproval,
        payment_status: "em_aprovacao" as ApPaymentStatus,
        is_distribution: false,
      };

      const { error: insertErr } = await supabase
        .from("ap_entries")
        .insert(newEntry as never);
      if (insertErr) throw insertErr;

      // Arquiva os originais
      const { error: archErr } = await supabase
        .from("ap_entries")
        .update({ archived_at: new Date().toISOString() } as never)
        .in("id", input.entryIds);
      if (archErr) throw archErr;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["ap-entries", v.hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
    },
  });
}