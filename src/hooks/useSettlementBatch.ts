import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BatchDetails } from "@/lib/settlementBatch";

export type BatchTarget = { source: "bank" | "rede" | "b2b"; id: string; label: string };
export function useSettlementBatch(hotelId: string, target: BatchTarget | null) {
  return useQuery({
    queryKey: ["settlement-batch", hotelId, target?.source, target?.id],
    enabled: !!target,
    refetchInterval: 10000,
    queryFn: async () => {
      if (!target) throw new Error("Selecione um lote");
      const { data, error } = await supabase.rpc("conc_settlement_batch_details", {
        p_hotel: hotelId, p_source: target.source, p_id: target.id,
      });
      if (error) throw error;
      return data as unknown as BatchDetails;
    },
  });
}