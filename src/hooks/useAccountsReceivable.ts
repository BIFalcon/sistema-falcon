import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ──────────────── A FATURAR ──────────────── */

export interface ToInvoiceEntry {
  id: string;
  upload_id: string;
  hotel_id: string | null;
  property_name_raw: string;
  account_number: string | null;
  account_name: string | null;
  account_type: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  transaction_date: string | null;
  amount: number | null;
  paid: number | null;
  ar_open: number | null;
  confirmation_number: string | null;
  reservation_status: string | null;
  departure_date: string | null;
}

export function useToInvoiceEntries(filters: { hotelId?: string | null }) {
  return useQuery({
    queryKey: ["ar-to-invoice", filters.hotelId ?? "all"],
    queryFn: async (): Promise<ToInvoiceEntry[]> => {
      let q = supabase
        .from("ar_to_invoice_entries")
        .select("id,upload_id,hotel_id,property_name_raw,account_number,account_name,account_type,invoice_number,invoice_status,transaction_date,amount,paid,ar_open,confirmation_number,reservation_status,departure_date")
        .order("transaction_date", { ascending: false })
        .limit(5000);
      if (filters.hotelId) q = q.eq("hotel_id", filters.hotelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ToInvoiceEntry[];
    },
  });
}

export function useLatestArUpload(kind: "to_invoice" | "open_folio") {
  return useQuery({
    queryKey: ["ar-latest-upload", kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_uploads")
        .select("*")
        .eq("kind", kind)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUploadArReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; kind: "to_invoice" | "open_folio" }) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("kind", input.kind);
      const { data, error } = await supabase.functions.invoke("parse-ar-report", { body: form });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ar-to-invoice"] });
      qc.invalidateQueries({ queryKey: ["ar-open-folio"] });
      qc.invalidateQueries({ queryKey: ["ar-latest-upload", v.kind] });
    },
  });
}

/* ──────────────── OPEN FOLIO ──────────────── */

export interface OpenFolioEntry {
  id: string;
  hotel_id: string | null;
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
}

export function useOpenFolioEntries() {
  return useQuery({
    queryKey: ["ar-open-folio"],
    queryFn: async (): Promise<OpenFolioEntry[]> => {
      const { data, error } = await supabase
        .from("ar_open_folio_entries")
        .select("id,hotel_id,property_name_raw,confirmation_number,reservation_status,first_name,last_name,balance,arrival_date,departure_date,extraction_date,days_open")
        .order("balance", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as OpenFolioEntry[];
    },
  });
}

export interface OpenFolioNote {
  id: string;
  hotel_id: string;
  confirmation_number: string;
  note: string;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export function useOpenFolioNotes(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ar-of-notes", hotelId],
    queryFn: async (): Promise<OpenFolioNote[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ar_open_folio_notes")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpenFolioNote[];
    },
  });
}

export function useUpsertOpenFolioNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotel_id: string; confirmation_number: string; note: string; author_id: string }) => {
      const { error } = await supabase.from("ar_open_folio_notes").insert(input);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ar-of-notes", v.hotel_id] });
    },
  });
}

/* ──────────────── CONTRATOS ──────────────── */

export interface ClientContract {
  id: string;
  hotel_id: string;
  account_number: string | null;
  account_name: string | null;
  payment_term_days: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useClientContracts(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ar-contracts", hotelId],
    queryFn: async (): Promise<ClientContract[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ar_client_contracts")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("account_name");
      if (error) throw error;
      return (data ?? []) as ClientContract[];
    },
  });
}

export function useUpsertContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      hotel_id: string;
      account_number: string | null;
      account_name: string | null;
      payment_term_days: number;
      notes: string | null;
      created_by: string;
    }) => {
      if (input.id) {
        const { error } = await supabase
          .from("ar_client_contracts")
          .update({
            account_number: input.account_number,
            account_name: input.account_name,
            payment_term_days: input.payment_term_days,
            notes: input.notes,
          })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ar_client_contracts").insert({
          hotel_id: input.hotel_id,
          account_number: input.account_number,
          account_name: input.account_name,
          payment_term_days: input.payment_term_days,
          notes: input.notes,
          created_by: input.created_by,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ar-contracts", v.hotel_id] }),
  });
}

export function useDeleteContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; hotel_id: string }) => {
      const { error } = await supabase.from("ar_client_contracts").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ar-contracts", v.hotel_id] }),
  });
}

/* ──────────────── HELPERS ──────────────── */

export function findContractTerm(
  contracts: ClientContract[] | undefined,
  accountNumber: string | null,
  accountName: string | null,
): number | null {
  if (!contracts?.length) return null;
  if (accountNumber) {
    const byNum = contracts.find((c) => c.account_number && c.account_number === accountNumber);
    if (byNum) return byNum.payment_term_days;
  }
  if (accountName) {
    const byName = contracts.find(
      (c) => !c.account_number && c.account_name && c.account_name.toLowerCase() === accountName.toLowerCase(),
    );
    if (byName) return byName.payment_term_days;
  }
  return null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}