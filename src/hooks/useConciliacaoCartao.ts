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
export type ConcKind = "cartao" | "pix_extrato" | "dinheiro";

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
  b2b: boolean;
  b2b_at: string | null;
  cash_paid_date: string | null;
  cash_proof_path: string | null;
  cash_paid_at: string | null;
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
  b2b: boolean;
  b2b_at: string | null;
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

export function useOperaEntries(hotelId: string | null, dateFrom?: string, dateTo?: string, dates?: string[]) {
  const days = dates ?? [];
  return useQuery({
    queryKey: ["conc-opera", hotelId ?? "none", dateFrom ?? "", dateTo ?? "", days.join(",")],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_opera_entries")
        .select("id, hotel_id, trx_code, trx_desc, categoria, amount, business_date, room, guest_full_name, receipt_no, direct_bank, direct_bank_at, matched_at, b2b, b2b_at, cash_paid_date, cash_proof_path, cash_paid_at")
        .eq("hotel_id", hotelId!)
        .order("business_date", { ascending: true })
        .limit(20000);
      if (days.length) q = q.in("business_date", days);
      else {
        if (dateFrom) q = q.gte("business_date", dateFrom);
        if (dateTo) q = q.lte("business_date", dateTo);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OperaEntry[];
    },
  });
}

export function useAcquirerEntries(hotelId: string | null, dateFrom?: string, dateTo?: string, dates?: string[]) {
  const days = dates ?? [];
  return useQuery({
    queryKey: ["conc-acquirer", hotelId ?? "none", dateFrom ?? "", dateTo ?? "", days.join(",")],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_acquirer_entries")
        .select("id, hotel_id, establishment_raw, sale_date, amount, bandeira, modalidade, categoria, status, matched_at, b2b, b2b_at")
        .eq("hotel_id", hotelId!)
        .order("sale_date", { ascending: true })
        .limit(20000);
      if (days.length) q = q.in("sale_date", days);
      else {
        if (dateFrom) q = q.gte("sale_date", dateFrom);
        if (dateTo) q = q.lte("sale_date", dateTo);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AcquirerEntry[];
    },
  });
}

export function useBankEntries(hotelId: string | null, dateFrom?: string, dateTo?: string, dates?: string[]) {
  const days = dates ?? [];
  return useQuery({
    queryKey: ["conc-bank", hotelId ?? "none", dateFrom ?? "", dateTo ?? "", days.join(",")],
    enabled: !!hotelId,
    queryFn: async () => {
      let q = supabase
        .from("conc_bank_entries")
        .select("id, hotel_id, account_name_raw, line_date, description, amount, matched_at")
        .eq("hotel_id", hotelId!)
        .order("line_date", { ascending: true })
        .limit(20000);
      if (days.length) q = q.in("line_date", days);
      else {
        if (dateFrom) q = q.gte("line_date", dateFrom);
        if (dateTo) q = q.lte("line_date", dateTo);
      }
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

/** Conciliação automática: casa pares exatos 1:1 (data + categoria + valor).
 *  Não substitui a conciliação manual — só resolve os casos óbvios. */
async function runAutoReconcile(hotelId?: string | null) {
  const { data, error } = await supabase.rpc("conc_auto_reconcile", hotelId ? { _hotel_id: hotelId } : {});
  if (error) throw error;
  return (data ?? 0) as number;
}

export function useAutoReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hotelId?: string | null) => runAutoReconcile(hotelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
  });
}

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

      const parsedOpera = await parseOperaXml(file, hotelId, active);
      const { skipped, total } = parsedOpera;
      // Relatório acumulado (MTD): descarta o que já existe.
      const knownOpera = await existingKeys("conc_opera_entries", hotelId);
      const rows = parsedOpera.rows.filter((r) => !knownOpera.has(r.entry_key));
      const duplicates = parsedOpera.rows.length - rows.length;

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          hotel_id: hotelId,
          kind: "opera",
          file_name: file.name,
          file_size: file.size,
          parsed_count: rows.length,
          skipped_count: skipped + duplicates,
          uploaded_by: user!.id,
          metadata: { total_rows: total, duplicates },
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

      const autoMatched = await runAutoReconcile(hotelId);
      return { inserted: rows.length, skipped, autoMatched, duplicates };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
  });
}

/** Busca as chaves já importadas para descartar duplicatas de planilhas MTD. */
async function existingKeys(
  table: "conc_opera_entries" | "conc_acquirer_entries" | "conc_bank_entries",
  hotelId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("entry_key")
      .eq("hotel_id", hotelId)
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) keys.add((r as { entry_key: string }).entry_key);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return keys;
}

export function useImportAcquirer() {
  const qc = useQueryClient();
  const { user, allowedHotels } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelId }: { file: File; hotelId: string }) => {
      const hotels = (allowedHotels ?? []) as unknown as HotelRef[];
      // Hotel identificado pelo CNPJ do hotel selecionado no filtro global.
      const { data: fin, error: finErr } = await supabase.rpc("get_hotel_financial", { _hotel_id: hotelId });
      if (finErr) throw finErr;
      const cnpj = (fin as unknown as { cnpj: string | null }[])?.[0]?.cnpj ?? null;
      const parsed = await parseAcquirerExcel(file, hotels, { id: hotelId, cnpj });
      const { skipped, unmatched, otherHotels } = parsed;

      // Planilha MTD (acumulada): descarta o que já foi importado antes.
      const known = await existingKeys("conc_acquirer_entries", hotelId);
      const rows = parsed.rows.filter((r) => !known.has(r.entry_key));
      const duplicates = parsed.rows.length - rows.length;

      const matchedHotelIds = [hotelId];

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          hotel_id: hotelId,
          kind: "acquirer",
          file_name: file.name,
          file_size: file.size,
          parsed_count: rows.length,
          skipped_count: skipped + duplicates + otherHotels,
          uploaded_by: user!.id,
          metadata: { unmatched, hotel_ids: matchedHotelIds, duplicates, other_hotels: otherHotels },
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

      const autoMatched = await runAutoReconcile(hotelId);
      return { inserted: rows.length, skipped, unmatched, autoMatched, duplicates, otherHotels };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
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

      // Extrato acumulado (MTD): descarta lançamentos já importados antes.
      const knownBank = await existingKeys("conc_bank_entries", hotelId);
      const bankRows = parsed.rows.filter((r) => !knownBank.has(r.entry_key));
      const duplicates = parsed.rows.length - bankRows.length;

      const { data: up, error: upErr } = await supabase
        .from("conc_uploads")
        .insert({
          hotel_id: hotelId,
          kind: "bank",
          file_name: file.name,
          file_size: file.size,
          parsed_count: bankRows.length,
          skipped_count: parsed.skipped + duplicates,
          uploaded_by: user!.id,
          metadata: { account_name: parsed.accountName, duplicates },
        })
        .select("id")
        .single();
      if (upErr) throw upErr;

      await upsertChunks("conc_bank_entries", bankRows.map((r) => ({
        hotel_id: hotelId,
        upload_id: up.id,
        entry_key: r.entry_key,
        account_name_raw: parsed.accountName,
        line_date: r.line_date || null,
        description: r.description,
        amount: r.amount,
        raw: r as unknown as Record<string, unknown>,
      })));

      const autoMatched = await runAutoReconcile(hotelId);
      return { inserted: bankRows.length, hotelId, accountName: parsed.accountName, autoMatched, duplicates };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-bank-all"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — conciliação manual                                      */
/* ------------------------------------------------------------------ */

/** Exclui uma importação e todos os lançamentos que vieram dela.
 *  Bloqueia se algum lançamento já foi conciliado (desfazer primeiro). */
export function useDeleteConcUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: string }) => {
      const table =
        kind === "opera" ? "conc_opera_entries"
        : kind === "acquirer" ? "conc_acquirer_entries"
        : "conc_bank_entries";

      const { data: matched, error: mErr } = await supabase
        .from(table)
        .select("id")
        .eq("upload_id", id)
        .not("matched_at", "is", null)
        .limit(1);
      if (mErr) throw mErr;
      if ((matched ?? []).length > 0) {
        throw new Error(
          "Esta importação possui lançamentos já conciliados. Desfaça as conciliações antes de excluir o arquivo.",
        );
      }

      const { error: delErr } = await supabase.from(table).delete().eq("upload_id", id);
      if (delErr) throw delErr;
      const { error: upErr } = await supabase.from("conc_uploads").delete().eq("id", id);
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-bank-all"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
    },
  });
}

const TABLE_BY_SIDE: Record<ConcSide, "conc_opera_entries" | "conc_acquirer_entries" | "conc_bank_entries"> = {
  opera: "conc_opera_entries",
  acquirer: "conc_acquirer_entries",
  bank: "conc_bank_entries",
};

export function useReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hotelId: string;
      kind: ConcKind;
      left: { side: ConcSide; id: string; amount: number }[];
      right: { side: ConcSide; id: string; amount: number }[];
      note?: string | null;
    }) => {
      // Operação atômica no banco: evita conciliações pela metade quando a
      // rede falha no meio (agrupamentos grandes faziam várias requisições).
      const items = [
        ...input.left.map((i) => ({ position: "left", side: i.side, id: i.id, amount: i.amount })),
        ...input.right.map((i) => ({ position: "right", side: i.side, id: i.id, amount: i.amount })),
      ];
      const { data, error } = await supabase.rpc("conc_reconcile_manual", {
        _hotel_id: input.hotelId,
        _kind: input.kind,
        _items: items,
        _note: input.note ?? null,
      });
      if (error) throw error;
      return data as unknown as string;
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
      const patch: { ativo?: boolean; categoria?: string | null } = {};
      if (ativo !== undefined) patch.ativo = ativo;
      if (categoria !== undefined) patch.categoria = categoria;
      const { error } = await supabase.from("trx_code_mapping").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trx-code-mapping"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Verificação automática: Faturamento pago × Extrato bancário         */
/* ------------------------------------------------------------------ */

export interface PaidVerificationInput {
  id: string;
  hotel_id: string | null;
  paid_date: string | null;
  amount: number | null;
}

/**
 * Roda sozinha sempre que o extrato é importado (a query é invalidada):
 * para cada lançamento de Faturamento marcado como pago, procura no extrato
 * do hotel uma linha com Data = paid_date e Valor positivo igual.
 * Retorna os ids sem correspondência — só considera hotéis/períodos que já
 * possuem extrato importado, para não gerar alerta falso.
 */
export function usePaidBankVerification(entries: PaidVerificationInput[], enabled: boolean) {
  const bank = useAllBankEntries(enabled);

  const missing = new Set<string>();
  if (enabled && bank.data) {
    const byHotel = new Map<string, { dates: Set<string>; min: string; max: string; amounts: Map<string, number> }>();
    for (const b of bank.data) {
      if (!b.hotel_id || !b.line_date) continue;
      let h = byHotel.get(b.hotel_id);
      if (!h) {
        h = { dates: new Set(), min: b.line_date, max: b.line_date, amounts: new Map() };
        byHotel.set(b.hotel_id, h);
      }
      h.dates.add(b.line_date);
      if (b.line_date < h.min) h.min = b.line_date;
      if (b.line_date > h.max) h.max = b.line_date;
      const key = `${b.line_date}|${Number(b.amount).toFixed(2)}`;
      h.amounts.set(key, (h.amounts.get(key) ?? 0) + 1);
    }

    for (const e of entries) {
      if (!e.hotel_id || !e.paid_date || e.amount == null) continue;
      const h = byHotel.get(e.hotel_id);
      if (!h) continue; // sem extrato importado para esse hotel
      if (e.paid_date < h.min || e.paid_date > h.max) continue; // fora do período coberto
      const key = `${e.paid_date}|${Math.abs(Number(e.amount)).toFixed(2)}`;
      if (!h.amounts.has(key)) missing.add(e.id);
    }
  }

  return { missing, isLoading: bank.isLoading, enabled };
}

/* ------------------------------------------------------------------ */
/* Ações em lote — B2B, direto no banco, dinheiro pago                 */
/* ------------------------------------------------------------------ */

/** Classifica lançamentos como B2B (é uma forma de conciliação: saem das pendências). */
export function useSetB2B() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ ids, side, value }: { ids: string[]; side: "opera" | "acquirer"; value: boolean }) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from(side === "opera" ? "conc_opera_entries" : "conc_acquirer_entries")
        .update({
          b2b: value,
          b2b_by: value ? user!.id : null,
          b2b_at: value ? new Date().toISOString() : null,
        })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-opera"] });
      qc.invalidateQueries({ queryKey: ["conc-acquirer"] });
    },
  });
}

/** Marca / desmarca vários itens do Opera como "recebido direto no banco". */
export function useSetDirectBankBulk() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("conc_opera_entries")
        .update({
          direct_bank: value,
          direct_bank_by: value ? user!.id : null,
          direct_bank_at: value ? new Date().toISOString() : null,
        })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conc-opera"] }),
  });
}

/** Dinheiro: marca lançamentos como pagos, com data e comprovante. */
export function useMarkCashPaid() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ ids, hotelId, paidDate, proof }: {
      ids: string[]; hotelId: string; paidDate: string; proof?: File | null;
    }) => {
      if (!ids.length) throw new Error("Selecione ao menos um lançamento.");
      if (!paidDate) throw new Error("Informe a data do pagamento.");
      let path: string | null = null;
      if (proof) {
        path = `${hotelId}/dinheiro/${Date.now()}-${proof.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("conciliacao-docs")
          .upload(path, proof, { upsert: false });
        if (upErr) throw upErr;
      }
      const { error } = await supabase
        .from("conc_opera_entries")
        .update({
          cash_paid_date: paidDate,
          cash_proof_path: path,
          cash_paid_by: user!.id,
          cash_paid_at: new Date().toISOString(),
        })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conc-opera"] }),
  });
}

export function useCashProofUrl() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage
        .from("conciliacao-docs")
        .createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Justificativas (GG e Admin)                                         */
/* ------------------------------------------------------------------ */

export interface ConcJustification {
  id: string;
  hotel_id: string;
  side: string;
  entry_id: string;
  kind: string;
  note: string;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export function useConcJustifications(hotelId: string | null) {
  return useQuery({
    queryKey: ["conc-justifications", hotelId ?? "none"],
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conc_justifications")
        .select("id, hotel_id, side, entry_id, kind, note, author_id, created_at, updated_at")
        .eq("hotel_id", hotelId!)
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ConcJustification[];
    },
  });
}

export function useSaveJustification() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ hotelId, side, entryId, kind, note }: {
      hotelId: string; side: ConcSide; entryId: string; kind: ConcKind; note: string;
    }) => {
      const { data: existing, error: selErr } = await supabase
        .from("conc_justifications")
        .select("id")
        .eq("entry_id", entryId)
        .eq("kind", kind)
        .limit(1);
      if (selErr) throw selErr;
      if ((existing ?? []).length) {
        const { error } = await supabase
          .from("conc_justifications")
          .update({ note, updated_at: new Date().toISOString() })
          .eq("id", existing![0].id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("conc_justifications").insert({
          hotel_id: hotelId, side, entry_id: entryId, kind, note, author_id: user!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conc-justifications"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Conciliados por importação (coluna "Conciliados" na Central)         */
/* ------------------------------------------------------------------ */

export function useMatchedCountsByUpload() {
  return useQuery({
    queryKey: ["conc-matched-by-upload"],
    queryFn: async () => {
      const counts = new Map<string, number>();
      for (const table of ["conc_opera_entries", "conc_acquirer_entries", "conc_bank_entries"] as const) {
        const { data, error } = await supabase
          .from(table)
          .select("upload_id")
          .not("matched_at", "is", null)
          .not("upload_id", "is", null)
          .limit(50000);
        if (error) throw error;
        for (const r of data ?? []) {
          const id = (r as { upload_id: string }).upload_id;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      return counts;
    },
  });
}
