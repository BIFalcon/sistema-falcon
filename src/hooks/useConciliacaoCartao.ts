import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  parseAcquirerExcel,
  parseBankStatement,
  parseOperaXml,
  normText,
  type HotelRef,
} from "@/lib/conciliacaoParsers";

export type ConcSide = "opera" | "acquirer" | "bank";
export type ConcKind = "cartao" | "pix_extrato";

export interface TrxCodeMap {
  id: string;
  trx_code: string;
  descricao: string | null;
  categoria: string | null;
  ativo: boolean;
}

export interface OperaEntry {
  id: string;
  hotel_id: string;
  trx_code: string;
  trx_desc: string | null;
  categoria: string | null;
  amount: number;
  business_date: string | null;
  room: string | null;
  guest_full_name: string | null;
  receipt_no: string | null;
  direct_bank: boolean;
  direct_bank_at: string | null;
  matched_at: string | null;
}

export interface AcquirerEntry {
  id: string;
  hotel_id: string;
  establishment_raw: string | null;
  sale_date: string | null;
  amount: number;
  bandeira: string | null;
  modalidade: string | null;
  categoria: string | null;
  status: string | null;
  matched_at: string | null;
}

export interface BankEntry {
  id: string;
  hotel_id: string;
  account_name_raw: string | null;
  line_date: string | null;
  description: string | null;
  amount: number;
  matched_at: string | null;
}

export interface ConcMatch {
  id: string;
  hotel_id: string;
  kind: ConcKind;
  left_total: number;
  right_total: number;
  difference: number;
  note: string | null;
  matched_by: string;
  matched_at: string;
  conc_match_items: { id: string; side: ConcSide; entry_id: string; amount: number }[];
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

export function useTrxCodeMapping() {
  return useQuery({
    queryKey: ["trx-code-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trx_code_mapping")
        .select("id, trx_code, descricao, categoria, ativo")
        .order("trx_code");
      if (error) throw error;
      return (data ?? []) as TrxCodeMap[];
    },
  });
}

export function useOperaEntries(hotelId: string | null, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["conc-opera", hotelId ?? "none", dateFrom ?? "", dateTo ?? ""],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_opera_entries")
        .select("id, hotel_id, trx_code, trx_desc, categoria, amount, business_date, room, guest_full_name, receipt_no, direct_bank, direct_bank_at, matched_at")
        .eq("hotel_id", hotelId!)
        .order("business_date", { ascending: true })
        .limit(20000);
      if (dateFrom) q = q.gte("business_date", dateFrom);
      if (dateTo) q = q.lte("business_date", dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OperaEntry[];
    },
  });
}

export function useAcquirerEntries(hotelId: string | null, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["conc-acquirer", hotelId ?? "none", dateFrom ?? "", dateTo ?? ""],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_acquirer_entries")
        .select("id, hotel_id, establishment_raw, sale_date, amount, bandeira, modalidade, categoria, status, matched_at")
        .eq("hotel_id", hotelId!)
        .order("sale_date", { ascending: true })
        .limit(20000);
      if (dateFrom) q = q.gte("sale_date", dateFrom);
      if (dateTo) q = q.lte("sale_date", dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AcquirerEntry[];
    },
  });
}

export function useBankEntries(hotelId: string | null, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["conc-bank", hotelId ?? "none", dateFrom ?? "", dateTo ?? ""],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_bank_entries")
        .select("id, hotel_id, account_name_raw, line_date, description, amount, matched_at")
        .eq("hotel_id", hotelId!)
        .order("line_date", { ascending: true })
        .limit(20000);
      if (dateFrom) q = q.gte("line_date", dateFrom);
      if (dateTo) q = q.lte("line_date", dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BankEntry[];
    },
  });
}

/** Extrato de todos os hotéis (usado na verificação Faturamento × Extrato). */
export function useAllBankEntries(enabled: boolean) {
  return useQuery({
    queryKey: ["conc-bank-all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conc_bank_entries")
        .select("id, hotel_id, line_date, description, amount")
        .gt("amount", 0)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as Pick<BankEntry, "id" | "hotel_id" | "line_date" | "amount">[];
    },
  });
}

export function useConcMatches(hotelId: string | null, kind: ConcKind) {
  return useQuery({
    queryKey: ["conc-matches", hotelId ?? "none", kind],
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conc_matches")
        .select("id, hotel_id, kind, left_total, right_total, difference, note, matched_by, matched_at, conc_match_items(id, side, entry_id, amount)")
        .eq("hotel_id", hotelId!)
        .eq("kind", kind)
        .order("matched_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as ConcMatch[];
    },
  });
}

export function useConcUploads() {
  return useQuery({
    queryKey: ["conc-uploads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conc_uploads")
        .select("id, hotel_id, kind, file_name, parsed_count, skipped_count, parse_error, uploaded_at, metadata")
        .order("uploaded_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — importações                                             */
/* ------------------------------------------------------------------ */

const CHUNK = 500;

async function upsertChunks<T>(table: "conc_opera_entries" | "conc_acquirer_entries" | "conc_bank_entries", rows: T[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(rows.slice(i, i + CHUNK) as any, { onConflict: "entry_key", ignoreDuplicates: true });
    if (error) throw error;
  }
}

export function useImportOpera() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelId }: { file: File; hotelId: string }) => {
      const { data: map, error: mapErr } = await supabase
        .from("trx_code_mapping")
        .select("trx_code, categoria, ativo")
        .eq("ativo", true);
      if (mapErr) throw mapErr;
      const byCode = new Map((map ?? []).map((m) => [m.trx_code, m.categoria]));
      const active = new Set(byCode.keys());

      const { rows, skipped, total } = await parseOperaXml(file, hotelId, active);

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          hotel_id: hotelId,
          kind: "opera",
          file_name: file.name,
          file_size: file.size,
          parsed_count: rows.length,
          skipped_count: skipped,
          uploaded_by: user!.id,
          metadata: { total_rows: total },
        })
        .select("id")
        .single();
      if (upErr) throw upErr;

      await upsertChunks("conc_opera_entries", rows.map((r) => ({
        hotel_id: hotelId,
        upload_id: up.id,
        entry_key: r.entry_key,
        trx_code: r.trx_code,
        trx_desc: r.trx_desc,
        categoria: normText(byCode.get(r.trx_code) ?? ""),
        amount: r.amount,
        business_date: r.business_date || null,
        room: r.room,
        guest_full_name: r.guest_full_name,
        receipt_no: r.receipt_no,
        raw: r as unknown as Record<string, unknown>,
      })));

      return { inserted: rows.length, skipped };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
    },
  });
}

export function useImportAcquirer() {
  const qc = useQueryClient();
  const { user, allowedHotels } = useAuth();
  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const hotels = (allowedHotels ?? []) as unknown as HotelRef[];
      const { rows, skipped, unmatched } = await parseAcquirerExcel(file, hotels);

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          kind: "acquirer",
          file_name: file.name,
          file_size: file.size,
          parsed_count: rows.length,
          skipped_count: skipped,
          uploaded_by: user!.id,
          metadata: { unmatched },
        })
        .select("id")
        .single();
      if (upErr) throw upErr;

      await upsertChunks("conc_acquirer_entries", rows.map((r) => ({
        hotel_id: r.hotel_id!,
        upload_id: up.id,
        entry_key: r.entry_key,
        establishment_raw: r.establishment_raw,
        sale_date: r.sale_date || null,
        amount: r.amount,
        bandeira: r.bandeira,
        modalidade: r.modalidade,
        categoria: r.categoria,
        status: r.status,
        raw: r as unknown as Record<string, unknown>,
      })));

      return { inserted: rows.length, skipped, unmatched };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
    },
  });
}

export function useImportBankStatement() {
  const qc = useQueryClient();
  const { user, allowedHotels } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelIdOverride }: { file: File; hotelIdOverride?: string | null }) => {
      const hotels = (allowedHotels ?? []) as unknown as HotelRef[];
      const parsed = await parseBankStatement(file, hotels);
      const hotelId = parsed.hotelId ?? hotelIdOverride ?? null;
      if (!hotelId) {
        throw new Error(
          `Não foi possível identificar o hotel pelo nome da conta ("${parsed.accountName || "sem nome"}"). Selecione o hotel antes de importar.`,
        );
      }

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          hotel_id: hotelId,
          kind: "bank",
          file_name: file.name,
          file_size: file.size,
          parsed_count: parsed.rows.length,
          skipped_count: parsed.skipped,
          uploaded_by: user!.id,
          metadata: { account_name: parsed.accountName },
        })
        .select("id")
        .single();
      if (upErr) throw upErr;

      await upsertChunks("conc_bank_entries", parsed.rows.map((r) => ({
        hotel_id: hotelId,
        upload_id: up.id,
        entry_key: r.entry_key,
        account_name_raw: parsed.accountName,
        line_date: r.line_date || null,
        description: r.description,
        amount: r.amount,
        raw: r as unknown as Record<string, unknown>,
      })));

      return { inserted: parsed.rows.length, hotelId, accountName: parsed.accountName };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-bank-all"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — conciliação manual                                      */
/* ------------------------------------------------------------------ */

const TABLE_BY_SIDE: Record<ConcSide, "conc_opera_entries" | "conc_acquirer_entries" | "conc_bank_entries"> = {
  opera: "conc_opera_entries",
  acquirer: "conc_acquirer_entries",
  bank: "conc_bank_entries",
};

export function useReconcile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      kind: ConcKind;
      left: { side: ConcSide; id: string; amount: number }[];
      right: { side: ConcSide; id: string; amount: number }[];
      note?: string | null;
    }) => {
      const leftTotal = input.left.reduce((s, i) => s + i.amount, 0);
      const rightTotal = input.right.reduce((s, i) => s + i.amount, 0);

      const { data: match, error } = await supabase
        .from("conc_matches")
        .insert({
          hotel_id: input.hotelId,
          kind: input.kind,
          left_total: leftTotal,
          right_total: rightTotal,
          difference: leftTotal - rightTotal,
          note: input.note ?? null,
          matched_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      const items = [...input.left, ...input.right].map((i) => ({
        match_id: match.id,
        side: i.side,
        entry_id: i.id,
        amount: i.amount,
      }));
      const { error: itemsErr } = await supabase.from("conc_match_items").insert(items);
      if (itemsErr) throw itemsErr;

      const now = new Date().toISOString();
      for (const side of ["opera", "acquirer", "bank"] as ConcSide[]) {
        const ids = items.filter((i) => i.side === side).map((i) => i.entry_id);
        if (!ids.length) continue;
        const { error: e } = await supabase
          .from(TABLE_BY_SIDE[side])
          .update({ matched_at: now })
          .in("id", ids);
        if (e) throw e;
      }
      return match.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
  });
}

export function useUndoReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (match: ConcMatch) => {
      for (const side of ["opera", "acquirer", "bank"] as ConcSide[]) {
        const ids = match.conc_match_items.filter((i) => i.side === side).map((i) => i.entry_id);
        if (!ids.length) continue;
        const { error } = await supabase
          .from(TABLE_BY_SIDE[side])
          .update({ matched_at: null })
          .in("id", ids);
        if (error) throw error;
      }
      const { error } = await supabase.from("conc_matches").delete().eq("id", match.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
  });
}

/** Marca / desmarca um item do Opera como "recebido direto no banco". */
export function useSetDirectBank() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from("conc_opera_entries")
        .update({
          direct_bank: value,
          direct_bank_by: value ? user!.id : null,
          direct_bank_at: value ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conc-opera"] }),
  });
}

export function useUpdateTrxCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ativo, categoria }: { id: string; ativo?: boolean; categoria?: string | null }) => {
      const patch: Record<string, unknown> = {};
      if (ativo !== undefined) patch.ativo = ativo;
      if (categoria !== undefined) patch.categoria = categoria;
      const { error } = await supabase.from("trx_code_mapping").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trx-code-mapping"] }),
  });
}
