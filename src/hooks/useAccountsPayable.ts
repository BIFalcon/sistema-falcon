import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FinancialSystem = "totvs" | "omie";
export type ApApproval = "pending" | "approved" | "rejected";
export type ApPaymentStatus = "pendente" | "inserido" | "agendado" | "pago";

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
}

export interface ApBankBalance {
  id: string;
  hotel_id: string;
  balance_date: string;
  amount: number;
  informed_by: string;
  updated_at: string;
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
  for (const file of input.files) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${input.hotelId}/documents/${ts}-${count}-${safe}`;
    const { error: upErr } = await supabase.storage
      .from("accounts-payable")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
    if (upErr) throw upErr;
    const { error: insErr } = await supabase.from("ap_documents").insert({
      hotel_id: input.hotelId,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: input.userId,
    });
    if (insErr) throw insErr;
    count++;
  }
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
}): Promise<{ ok: boolean; sent?: number; recipients?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("notify-gg-ap", {
    body: {
      hotel_id: input.hotelId,
      entry_ids: input.entryIds,
      due_from: input.dueFrom ?? null,
      due_to: input.dueTo ?? null,
    },
  });
  if (error) throw error;
  return data as any;
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
  return data as any;
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

export function useTodayBankBalance(hotelId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-balance", hotelId, today],
    queryFn: async (): Promise<ApBankBalance | null> => {
      if (!hotelId) return null;
      const { data, error } = await supabase
        .from("ap_bank_balance")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("balance_date", today)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ApBankBalance | null;
    },
  });
}

export function useUpsertBankBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; amount: number; userId: string }) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from("ap_bank_balance")
        .upsert(
          {
            hotel_id: input.hotelId,
            balance_date: today,
            amount: input.amount,
            informed_by: input.userId,
          },
          { onConflict: "hotel_id,balance_date" },
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
}): Promise<{ entries: number; documents_extracted: number }> {
  const form = new FormData();
  form.append("hotel_id", input.hotelId);
  form.append("source_system", input.sourceSystem);
  form.append("file", input.file);
  const { data, error } = await supabase.functions.invoke("parse-ap-report", {
    body: form,
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { entries: number; documents_extracted: number };
}