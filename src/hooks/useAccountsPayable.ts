import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FinancialSystem = "totvs" | "omie";
export type ApApproval = "pending" | "approved" | "rejected";

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
}

export interface ApBankBalance {
  id: string;
  hotel_id: string;
  balance_date: string;
  amount: number;
  informed_by: string;
  updated_at: string;
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