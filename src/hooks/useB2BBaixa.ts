import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseB2BReceivablesExcel } from "@/lib/conciliacaoParsers";
import { B2B_BANK_PREFIX } from "@/lib/b2bBaixa";

export interface B2BReceipt {
  id: string;
  hotel_id: string;
  data_operacao: string | null;
  tipo_lancamento: string;
  descricao: string | null;
  valor_total_transacao: number | null;
  valor_recebivel_bruto: number | null;
  valor_recebivel_liquido: number | null;
  bandeira: string | null;
  localizador_reserva: string | null;
  matched_acquirer_id: string | null;
  deposit_id: string | null;
  matched_bank_id: string | null;
  matched_at: string | null;
}

export interface B2BSale {
  id: string;
  sale_date: string | null;
  amount: number;
  bandeira: string | null;
  codigo_reserva: string | null;
  valor_liquido: number | null;
}

export interface BaixaBank {
  id: string;
  line_date: string | null;
  description: string | null;
  amount: number;
  matched_at: string | null;
}

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Busca TODAS as pendentes (sem limitar ao vencimento do dia — cobre antecipação/feriado). */
export function useB2BBaixaData(hotelId: string | null) {
  return useQuery({
    queryKey: ["conc-b2b-baixa", hotelId ?? "none"],
    enabled: !!hotelId,
    queryFn: async () => {
      const [receipts, sales, bank] = await Promise.all([
        pageAll<B2BReceipt>((a, b) => supabase.from("conc_b2b_receipts")
          .select("id, hotel_id, data_operacao, tipo_lancamento, descricao, valor_total_transacao, valor_recebivel_bruto, valor_recebivel_liquido, bandeira, localizador_reserva, matched_acquirer_id, deposit_id, matched_bank_id, matched_at")
          .eq("hotel_id", hotelId!).order("data_operacao").order("id").range(a, b)),
        pageAll<B2BSale>((a, b) => supabase.from("conc_acquirer_entries")
          .select("id, sale_date, amount, bandeira, codigo_reserva, valor_liquido")
          .eq("hotel_id", hotelId!).eq("source", "b2b").not("matched_at", "is", null)
          .order("sale_date").order("id").range(a, b)),
        pageAll<BaixaBank>((a, b) => supabase.from("conc_bank_entries")
          .select("id, line_date, description, amount, matched_at")
          .eq("hotel_id", hotelId!).ilike("description", `${B2B_BANK_PREFIX}%`)
          .order("line_date").order("id").range(a, b)),
      ]);
      return { receipts, sales, bank };
    },
  });
}

async function runMatch(hotelId: string) {
  const { data, error } = await supabase.rpc("conc_b2b_auto_match", { p_hotel: hotelId, p_bank_prefix: B2B_BANK_PREFIX });
  if (error) throw error;
  return data as { sales_linked: number; lots_linked: number; deposits_matched: number };
}

export function useB2BAutoMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runMatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-b2b-baixa"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["settlement-cutoff"] });
      qc.invalidateQueries({ queryKey: ["conc-daily-closing"] });
    },
  });
}

export function useB2BUnmatchDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (depositId: string) => {
      const { error } = await supabase.rpc("conc_b2b_unmatch_deposit", { p_deposit: depositId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-b2b-baixa"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["settlement-cutoff"] });
      qc.invalidateQueries({ queryKey: ["conc-daily-closing"] });
    },
  });
}

export function useImportB2BReceipts() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelId }: { file: File; hotelId: string }) => {
      const parsed = await parseB2BReceivablesExcel(file, hotelId);
      if (parsed.rows.length === 0) throw new Error("Nenhum lançamento charge/deposit encontrado no arquivo.");
      const { data: up, error: upErr } = await supabase.from("conc_uploads").insert({
        hotel_id: hotelId, kind: "b2b_receipts", file_name: file.name, file_size: file.size,
        parsed_count: parsed.rows.length, skipped_count: parsed.skipped, uploaded_by: user!.id,
        metadata: { source: "b2b_receipts", hotel_ids: [hotelId] },
      }).select("id").single();
      if (upErr) throw upErr;
      let inserted = 0;
      for (let i = 0; i < parsed.rows.length; i += 500) {
        const chunk = parsed.rows.slice(i, i + 500).map((r) => ({ ...r, upload_id: up.id }));
        const { data, error } = await supabase.from("conc_b2b_receipts")
          .upsert(chunk, { onConflict: "entry_key", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
      const match = await runMatch(hotelId);
      return { inserted, duplicates: parsed.rows.length - inserted, ...match };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-b2b-baixa"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["settlement-cutoff"] });
      qc.invalidateQueries({ queryKey: ["conc-daily-closing"] });
    },
  });
}
