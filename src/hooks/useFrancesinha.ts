import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseFrancesinhaExcel } from "@/lib/francesinha";

export interface FrancesinhaEntry {
  id: string; data_movimento: string | null; pagador: string | null; nosso_numero: string | null; seu_numero: string | null;
  vencimento: string | null; valor_inicial: number | null; descricao_operacao: string | null; operacoes_valor: string | null;
  valor_final: number | null; acao: string | null; result: string | null; matched_ar_id: string | null;
}

export function useFrancesinhaEntries(hotelId: string | null) {
  return useQuery({
    queryKey: ["conc-francesinha", hotelId ?? "none"],
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("conc_francesinha_entries")
        .select("id, data_movimento, pagador, nosso_numero, seu_numero, vencimento, valor_inicial, descricao_operacao, operacoes_valor, valor_final, acao, result, matched_ar_id")
        .eq("hotel_id", hotelId!).order("data_movimento", { ascending: false }).order("id").limit(5000);
      if (error) throw error;
      return (data ?? []) as FrancesinhaEntry[];
    },
  });
}

export function useImportFrancesinha() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, hotelId }: { file: File; hotelId: string }) => {
      const rows = await parseFrancesinhaExcel(file, hotelId);
      if (!rows.length) throw new Error("Nenhuma movimentação detalhada encontrada na francesinha.");
      const { data: up, error: upErr } = await supabase.from("conc_uploads").insert({
        hotel_id: hotelId, kind: "francesinha", file_name: file.name, file_size: file.size,
        parsed_count: rows.length, skipped_count: 0, uploaded_by: user!.id, metadata: { source: "francesinha", hotel_ids: [hotelId] },
      }).select("id").single();
      if (upErr) throw upErr;
      const { data, error } = await supabase.from("conc_francesinha_entries")
        .upsert(rows.map((r) => ({ ...r, upload_id: up.id })), { onConflict: "entry_key", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      const { data: res, error: rpcErr } = await supabase.rpc("conc_francesinha_apply", { p_hotel: hotelId });
      if (rpcErr) throw rpcErr;
      return { inserted: data?.length ?? 0, duplicates: rows.length - (data?.length ?? 0), ...(res as { paid: number; pending: number; info: number; adjustments: number }) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conc-francesinha"] });
      qc.invalidateQueries({ queryKey: ["conc-uploads"] });
      qc.invalidateQueries({ queryKey: ["ar-billing-due"] });
    },
  });
}

export interface BillingDue { id: string; account_name: string | null; invoice_number: string | null; boleto_number: string | null; boleto_due_date: string | null; amount: number | null }

/** Faturamentos em aberto do hotel com vencimento entre `from` e `to`. */
export function useBillingDue(hotelId: string | null, from: string | null, to: string | null) {
  return useQuery({
    queryKey: ["ar-billing-due", hotelId ?? "none", from, to],
    enabled: !!hotelId && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await supabase.from("ar_to_invoice_entries")
        .select("id, account_name, invoice_number, boleto_number, boleto_due_date, amount")
        .eq("hotel_id", hotelId!).eq("is_paid", false).gte("boleto_due_date", from!).lte("boleto_due_date", to!)
        .order("boleto_due_date").limit(500);
      if (error) throw error;
      return (data ?? []) as BillingDue[];
    },
  });
}
