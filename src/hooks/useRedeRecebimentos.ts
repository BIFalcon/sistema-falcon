import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AnticipatedPayment } from "@/lib/anticipationSimulation";
import { parseRedeRecebimentosExcel, REDE_BANK_PREFIX, REDE_BRAND_CODES, REDE_MOD_CODES } from "@/lib/redeRecebimentos";

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export interface RecebidoRow { id: string; data: string | null; bandeira: string | null; modalidade: string | null; valor_depositado: number | null; status: string | null; matched_bank_id: string | null; matched_at: string | null }
export interface ChargebackRow { id: string; data_debito: string | null; tipo: string | null; data_original_venda: string | null; valor_original_venda: number | null; valor_descontado: number | null; motivo_cancelamento: string | null; nsu_cv: string | null; bandeira: string | null; modalidade: string | null }
export interface AjusteRow { id: string; data_ajuste: string | null; motivo: string | null; valor_cobrado: number | null; bandeira: string | null }
export interface BankRow { id: string; line_date: string | null; description: string | null; amount: number; matched_at: string | null }

export function useRedeRecebimentosData(hotelId: string | null) {
  return useQuery({
    queryKey: ["conc-rede-receb", hotelId ?? "none"],
    enabled: !!hotelId,
    queryFn: async () => {
      if (!hotelId) throw new Error("Selecione um hotel");
      const h = hotelId;
      const rules = await supabase.from("conc_bank_receipt_rules").select("prefix").eq("hotel_id", h).eq("enabled", true);
      if (rules.error) throw rules.error;
      const [recebidos, chargebacks, ajustes, pagamentos, b2b, bank] = await Promise.all([
        pageAll<RecebidoRow>((a, b) => supabase.from("conc_rede_recebidos").select("id, data, bandeira, modalidade, valor_depositado, status, matched_bank_id, matched_at").eq("hotel_id", h).order("data").order("id").range(a, b)),
        pageAll<ChargebackRow>((a, b) => supabase.from("conc_rede_chargebacks").select("id, data_debito, tipo, data_original_venda, valor_original_venda, valor_descontado, motivo_cancelamento, nsu_cv, bandeira, modalidade").eq("hotel_id", h).order("data_debito").order("id").range(a, b)),
        pageAll<AjusteRow>((a, b) => supabase.from("conc_rede_ajustes").select("id, data_ajuste, motivo, valor_cobrado, bandeira").eq("hotel_id", h).order("data_ajuste").order("id").range(a, b)),
        pageAll<AnticipatedPayment & { valor_mdr: number | null }>((a, b) => supabase.from("conc_rede_pagamentos").select("data_recebimento, data_original_vencimento, valor_liquido_parcela, valor_mdr").eq("hotel_id", h).order("id").range(a, b)),
        pageAll<{ data_operacao: string | null; valor_taxa_adquirencia: number | null }>((a, b) => supabase.from("conc_b2b_receipts").select("data_operacao, valor_taxa_adquirencia").eq("hotel_id", h).eq("tipo_lancamento", "charge").order("id").range(a, b)),
        pageAll<BankRow>((a, b) => supabase.from("conc_bank_entries").select("id, line_date, description, amount, matched_at").eq("hotel_id", h).order("line_date").order("id").range(a, b)),
      ]);
      // Venda original do chargeback pelo NSU.
      const nsus = [...new Set(chargebacks.map((c) => c.nsu_cv).filter(Boolean) as string[])];
      let sales: { id: string; nsu: string | null; sale_date: string | null; amount: number }[] = [];
      if (nsus.length) {
        const { data, error } = await supabase.from("conc_acquirer_entries").select("id, nsu, sale_date, amount").eq("hotel_id", h).in("nsu", nsus);
        if (error) throw error;
        sales = data ?? [];
      }
      const prefixes = [REDE_BANK_PREFIX, ...rules.data.map(r => r.prefix)].map(p => p.trim().toUpperCase());
      return { recebidos, chargebacks, ajustes, pagamentos, b2b, bank: bank.filter(b => prefixes.some(p => b.description?.trim().toUpperCase().startsWith(p))), sales };
    },
  });
}

async function runMatch(hotelId: string) {
  const { data, error } = await supabase.rpc("conc_rede_auto_match", {
    p_hotel: hotelId, p_bank_prefix: REDE_BANK_PREFIX, p_brand_map: REDE_BRAND_CODES, p_mod_map: REDE_MOD_CODES,
  });
  if (error) throw error;
  return data as { matched: number };
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["conc-rede-receb"] });
  qc.invalidateQueries({ queryKey: ["ap-simulations"] });
  qc.invalidateQueries({ queryKey: ["ap-anticipation-list"] });
  qc.invalidateQueries({ queryKey: ["conc-bank"] });
  qc.invalidateQueries({ queryKey: ["conc-uploads"] });
  qc.invalidateQueries({ queryKey: ["settlement-cutoff"] });
  qc.invalidateQueries({ queryKey: ["conc-daily-closing"] });
};

export function useRedeAutoMatch() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: runMatch, onSuccess: () => invalidate(qc) });
}

export function useRedeUnmatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("conc_rede_unmatch", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useImportRedeRecebimentos() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelId }: { file: File; hotelId: string }) => {
      const p = await parseRedeRecebimentosExcel(file, hotelId);
      if (!user) throw new Error("Entre novamente no sistema");
      const total = p.pagamentos.length + p.recebidos.length + p.ajustes.length + p.chargebacks.length;
      if (!total) throw new Error("Nenhum lançamento encontrado no relatório de recebimentos.");
      const { data: up, error: upErr } = await supabase.from("conc_uploads").insert({
        hotel_id: hotelId, kind: "rede_receipts", file_name: file.name, file_size: file.size,
        parsed_count: total, skipped_count: 0, uploaded_by: user.id,
        metadata: { source: "rede_receipts", hotel_ids: [hotelId] },
      }).select("id").single();
      if (upErr) throw upErr;
      const ins = async (table: "conc_rede_pagamentos" | "conc_rede_recebidos" | "conc_rede_ajustes" | "conc_rede_chargebacks", rows: object[]) => {
        let n = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, upload_id: up.id }));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase.from(table) as any).upsert(chunk, { onConflict: "entry_key", ignoreDuplicates: true }).select("id");
          if (error) throw error;
          n += data?.length ?? 0;
        }
        return n;
      };
      const counts = {
        pagamentos: await ins("conc_rede_pagamentos", p.pagamentos),
        recebidos: await ins("conc_rede_recebidos", p.recebidos),
        ajustes: await ins("conc_rede_ajustes", p.ajustes),
        chargebacks: await ins("conc_rede_chargebacks", p.chargebacks),
      };
      const { data: allowed, error: accessError } = await supabase.rpc("can_manage_anticipation", { p_user: user.id });
      if (accessError) throw accessError;
      if (allowed) {
        const { error } = await supabase.rpc("ap_reconcile_simulations", { p_hotel: hotelId });
        if (error) throw error;
      }
      const match = await runMatch(hotelId);
      return { ...counts, ...match };
    },
    onSuccess: () => invalidate(qc),
  });
}
