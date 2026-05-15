import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { ClosingStatus } from "@/lib/constants";

export interface EnvioRow {
  id: string;
  hotel_id: string;
  month: number;
  year: number;
  status_carta: ClosingStatus;
  status_financeiro: ClosingStatus;
  status_envio: ClosingStatus;
  carta_approved_at: string | null;
  envio_sent_at: string | null;
  final_distribution: number | null;
  estimated_distribution: number | null;
  distribution_decision: string | null;
  pdf_url: string | null;
  pdf_generated_at: string | null;
}

/**
 * Fila de envio do RI: fechamentos cuja Carta foi aprovada e que possuem PDF
 * pronto. Inclui status do envio para histórico.
 */
export function useEnvioQueue(params: {
  month: number;
  year: number;
  hotelId?: string | null;
}) {
  const { month, year, hotelId } = params;
  return useQuery({
    queryKey: ["envio-queue", year, month, hotelId ?? "all"],
    queryFn: async (): Promise<EnvioRow[]> => {
      let q = supabase
        .from("closings")
        .select(
          "id, hotel_id, month, year, status_carta, status_financeiro, status_envio, carta_approved_at, envio_sent_at, final_distribution, estimated_distribution, distribution_decision",
        )
        .eq("month", month)
        .eq("year", year)
        .in("status_carta", ["aprovado", "nao_aplicavel"])
        .order("hotel_id");
      if (hotelId) q = q.eq("hotel_id", hotelId);
      const { data, error } = await q;
      if (error) throw error;

      const closings = (data ?? []) as Array<Omit<EnvioRow, "pdf_url" | "pdf_generated_at">>;
      if (closings.length === 0) return [];

      // Buscar PDFs das cartas em paralelo
      const ids = closings.map((c) => c.id);
      const { data: letters } = await supabase
        .from("investor_letters")
        .select("closing_id, pdf_url, pdf_generated_at")
        .in("closing_id", ids);
      const byClosing = new Map(
        (letters ?? []).map((l) => [l.closing_id, l]),
      );

      return closings.map((c) => ({
        ...c,
        pdf_url: byClosing.get(c.id)?.pdf_url ?? null,
        pdf_generated_at: byClosing.get(c.id)?.pdf_generated_at ?? null,
      }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Marca o envio como concluído (status_envio = 'aprovado'). O trigger no banco
 * preenche envio_sent_at automaticamente.
 */
export function useMarkEnvioSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { closingId: string }) => {
      const { error } = await supabase
        .from("closings")
        .update({ status_envio: "aprovado" } as TablesUpdate<"closings">)
        .eq("id", input.closingId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["envio-queue"] });
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
    },
  });
}

/**
 * Reverte o envio (volta para 'em_andamento'), caso o RI precise reabrir.
 */
export function useReopenEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { closingId: string }) => {
      const { error } = await supabase
        .from("closings")
        .update({ status_envio: "em_andamento" } as TablesUpdate<"closings">)
        .eq("id", input.closingId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["envio-queue"] });
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
    },
  });
}
