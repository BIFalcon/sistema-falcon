import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClosingStatus } from "@/lib/constants";

export type DistributionDecision = "enviado" | "sem_distribuicao" | "pendente";

export interface FinanceiroRow {
  id: string;
  hotel_id: string;
  month: number;
  year: number;
  status_dre: ClosingStatus;
  status_financeiro: ClosingStatus;
  estimated_distribution: number | null;
  estimated_lines: unknown;
  estimated_at: string | null;
  final_distribution: number | null;
  distribution_decision: DistributionDecision | null;
  distribution_notes: string | null;
  distribution_decided_by: string | null;
  distribution_decided_at: string | null;
}

/**
 * Lista fechamentos do mês cuja DRE já foi aprovada — fila de trabalho do
 * Financeiro. RLS já restringe ao escopo do usuário.
 */
export function useFinanceiroQueue(params: {
  month: number;
  year: number;
  hotelId?: string | null;
}) {
  const { month, year, hotelId } = params;
  return useQuery({
    queryKey: ["financeiro-queue", year, month, hotelId ?? "all"],
    queryFn: async (): Promise<FinanceiroRow[]> => {
      let q = supabase
        .from("closings")
        .select(
          "id, hotel_id, month, year, status_dre, status_financeiro, estimated_distribution, estimated_lines, estimated_at, final_distribution, distribution_decision, distribution_notes, distribution_decided_by, distribution_decided_at",
        )
        .eq("month", month)
        .eq("year", year)
        .eq("status_dre", "aprovado")
        .order("hotel_id");
      if (hotelId) q = q.eq("hotel_id", hotelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as FinanceiroRow[];
    },
  });
}

/**
 * Registra a decisão do Financeiro: enviado / sem distribuição / pendente.
 * Atualiza também `status_financeiro` para refletir a decisão.
 */
export function useRecordDistribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      closingId: string;
      decision: DistributionDecision;
      finalValue: number | null;
      notes: string | null;
      userId: string;
    }) => {
      const { closingId, decision, finalValue, notes, userId } = input;
      const status_financeiro: ClosingStatus =
        decision === "enviado"
          ? "aprovado"
          : decision === "sem_distribuicao"
            ? "sem_distribuicao"
            : "pendente";
      const { error } = await supabase
        .from("closings")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          distribution_decision: decision,
          final_distribution: decision === "enviado" ? finalValue : null,
          distribution_notes: notes,
          distribution_decided_by: userId,
          distribution_decided_at: new Date().toISOString(),
          status_financeiro,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .eq("id", closingId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["financeiro-queue"] });
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
    },
  });
}