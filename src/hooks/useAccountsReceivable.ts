import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseArReportFile, type ParsedOpenFolioEntry, type ParsedToInvoiceEntry } from "@/lib/arReportParser";

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
  gg_status: "pendente" | "faturado" | "nao_faturado" | "documentos_enviados" | "nao_faturavel" | "pago" | "inadimplente";
  gg_note: string | null;
  gg_confirmed_by: string | null;
  gg_confirmed_at: string | null;
  paid_date: string | null;
  paid_note: string | null;
  estimated_due_date: string | null;
  invoice_file_1: string | null;
  invoice_file_2: string | null;
  is_not_billable: boolean;
  not_billable_reason: string | null;
  not_billable_note: string | null;
  proof_file: string | null;
  is_paid: boolean;
  paid_at: string | null;
  is_defaulting: boolean;
  defaulting_note: string | null;
  defaulting_at: string | null;
  documents_problem_note: string | null;
  documents_problem_at: string | null;
  billed_at: string | null;
  nota_number: string | null;
  boleto_number: string | null;
  boleto_due_date: string | null;
  doc_extraction_status: string | null;
}

export function useToInvoiceEntries(filters: { hotelId?: string | null }) {
  return useQuery({
    queryKey: ["ar-to-invoice", filters.hotelId ?? "all"],
    queryFn: async (): Promise<ToInvoiceEntry[]> => {
      let q = supabase
        .from("ar_to_invoice_entries")
        .select("id,upload_id,hotel_id,property_name_raw,account_number,account_name,account_type,invoice_number,invoice_status,transaction_date,amount,paid,ar_open,confirmation_number,reservation_status,departure_date,gg_status,gg_note,gg_confirmed_by,gg_confirmed_at,paid_date,paid_note,estimated_due_date,invoice_file_1,invoice_file_2,is_not_billable,not_billable_reason,not_billable_note,proof_file,is_paid,paid_at,is_defaulting,defaulting_note,defaulting_at,documents_problem_note,documents_problem_at,billed_at,nota_number,boleto_number,boleto_due_date,doc_extraction_status")
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

/** Data máxima de `transaction_date` no acervo de A Faturar (filtrável por hotel). */
export function useLatestToInvoiceDate(hotelId: string | null) {
  return useQuery({
    queryKey: ["ar-latest-ti-date", hotelId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("ar_to_invoice_entries")
        .select("transaction_date")
        .not("transaction_date", "is", null)
        .order("transaction_date", { ascending: false })
        .limit(1);
      if (hotelId) q = q.eq("hotel_id", hotelId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data?.transaction_date ?? null;
    },
  });
}

export function useUploadArReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; kind: "to_invoice" | "open_folio" }) => {
      const parsedEntries = await parseArReportFile(input.file, input.kind);
      const form = new FormData();
      form.append("file", input.file);
      form.append("kind", input.kind);
      form.append("entries", JSON.stringify(parsedEntries));
      const { data, error } = await supabase.functions.invoke("parse-ar-report", { body: form });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return {
        ...data,
        entries: data?.entries ?? parsedEntries.length,
      } as {
        ok: boolean;
        upload_id: string;
        entries: number;
        unmapped_properties: string[];
        total_rows?: number;
        skipped_existing?: number;
        skipped_duplicate_in_file?: number;
      };
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ar-to-invoice"] });
      qc.invalidateQueries({ queryKey: ["ar-open-folio"] });
      qc.invalidateQueries({ queryKey: ["ar-latest-upload", v.kind] });
    },
  });
}

/* Confirmação por GG dos registros A Faturar */
export function useSetToInvoiceGgStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      gg_status: ToInvoiceEntry["gg_status"];
      gg_note?: string | null;
      paid_date?: string | null;
      paid_note?: string | null;
      estimated_due_date?: string | null;
      invoice_file_1?: string | null;
      invoice_file_2?: string | null;
      is_not_billable?: boolean;
      not_billable_reason?: string | null;
      not_billable_note?: string | null;
      proof_file?: string | null;
      is_paid?: boolean;
      paid_at?: string | null;
      is_defaulting?: boolean;
      defaulting_note?: string | null;
      defaulting_at?: string | null;
      documents_problem_note?: string | null;
      documents_problem_at?: string | null;
      billed_at?: string | null;
    }) => {
      const { error } = await supabase
        .from("ar_to_invoice_entries")
        .update({
          gg_status: input.gg_status,
          gg_note: input.gg_note ?? null,
          ...(input.paid_date !== undefined ? { paid_date: input.paid_date } : {}),
          ...(input.paid_note !== undefined ? { paid_note: input.paid_note } : {}),
          ...(input.estimated_due_date !== undefined ? { estimated_due_date: input.estimated_due_date } : {}),
          ...(input.invoice_file_1 !== undefined ? { invoice_file_1: input.invoice_file_1 } : {}),
          ...(input.invoice_file_2 !== undefined ? { invoice_file_2: input.invoice_file_2 } : {}),
          ...(input.is_not_billable !== undefined ? { is_not_billable: input.is_not_billable } : {}),
          ...(input.not_billable_reason !== undefined ? { not_billable_reason: input.not_billable_reason } : {}),
          ...(input.not_billable_note !== undefined ? { not_billable_note: input.not_billable_note } : {}),
          ...(input.proof_file !== undefined ? { proof_file: input.proof_file } : {}),
          ...(input.is_paid !== undefined ? { is_paid: input.is_paid } : {}),
          ...(input.paid_at !== undefined ? { paid_at: input.paid_at } : {}),
          ...(input.is_defaulting !== undefined ? { is_defaulting: input.is_defaulting } : {}),
          ...(input.defaulting_note !== undefined ? { defaulting_note: input.defaulting_note } : {}),
          ...(input.defaulting_at !== undefined ? { defaulting_at: input.defaulting_at } : {}),
          ...(input.documents_problem_note !== undefined ? { documents_problem_note: input.documents_problem_note } : {}),
          ...(input.documents_problem_at !== undefined ? { documents_problem_at: input.documents_problem_at } : {}),
          ...(input.billed_at !== undefined ? { billed_at: input.billed_at } : {}),
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-to-invoice"] });
    },
  });
}

/* Desfazer upload AR (deleta o upload e as linhas dependentes) */
export function useDeleteArUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uploadId: string; kind: "to_invoice" | "open_folio" }) => {
      const table = input.kind === "to_invoice" ? "ar_to_invoice_entries" : "ar_open_folio_entries";
      // Remove linhas dependentes (não há FK cascade no schema)
      await supabase.from(table).delete().eq("upload_id", input.uploadId);
      const { error } = await supabase.from("ar_uploads").delete().eq("id", input.uploadId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ar-to-invoice"] });
      qc.invalidateQueries({ queryKey: ["ar-open-folio"] });
      qc.invalidateQueries({ queryKey: ["ar-latest-upload", v.kind] });
    },
  });
}

/* Lista uploads AR de um kind (para calcular "dias pendente" do Faturamento) */
export function useArUploadsByKind(kind: "to_invoice" | "open_folio") {
  return useQuery({
    queryKey: ["ar-uploads-by-kind", kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_uploads")
        .select("id,uploaded_at")
        .eq("kind", kind)
        .order("uploaded_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; uploaded_at: string }[];
    },
  });
}

/* Notifica GGs com registros novos / pendentes em A Faturar */
export function useNotifyGgToInvoice() {
  return useMutation({
    mutationFn: async (input: { hotel_id?: string }) => {
      const { data, error } = await supabase.functions.invoke(
        "notify-gg-to-invoice",
        { body: { hotel_id: input.hotel_id } },
      );
      if (error) throw error;
      return data as { ok: boolean; hotels_notified: number };
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
  expected_payment_date: string | null;
  archived_at: string | null;
  company: string | null;
  travel_agent: string | null;
}

export type { ParsedOpenFolioEntry, ParsedToInvoiceEntry };

export function useOpenFolioEntries() {
  return useQuery({
    queryKey: ["ar-open-folio"],
    queryFn: async (): Promise<OpenFolioEntry[]> => {
      const { data, error } = await supabase
        .from("ar_open_folio_entries")
        .select("id,hotel_id,property_name_raw,confirmation_number,reservation_status,first_name,last_name,balance,arrival_date,departure_date,extraction_date,days_open,expected_payment_date,archived_at,company,travel_agent")
        .is("archived_at", null)
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
  expected_payment_date: string | null;
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

export function useAllOpenFolioNotes() {
  return useQuery({
    queryKey: ["ar-of-notes-all"],
    queryFn: async (): Promise<OpenFolioNote[]> => {
      const { data, error } = await supabase
        .from("ar_open_folio_notes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpenFolioNote[];
    },
  });
}

export function useUpsertOpenFolioNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotel_id: string; confirmation_number: string; note: string; author_id: string; expected_payment_date?: string | null }) => {
      const { error } = await supabase.from("ar_open_folio_notes").insert({
        hotel_id: input.hotel_id,
        confirmation_number: input.confirmation_number,
        note: input.note,
        author_id: input.author_id,
        expected_payment_date: input.expected_payment_date ?? null,
      });
      if (error) throw error;
      // Espelha a data prevista no folio para facilitar leitura na listagem
      if (input.expected_payment_date !== undefined) {
        await supabase
          .from("ar_open_folio_entries")
          .update({ expected_payment_date: input.expected_payment_date })
          .eq("hotel_id", input.hotel_id)
          .eq("confirmation_number", input.confirmation_number);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ar-of-notes", v.hotel_id] });
      qc.invalidateQueries({ queryKey: ["ar-open-folio"] });
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