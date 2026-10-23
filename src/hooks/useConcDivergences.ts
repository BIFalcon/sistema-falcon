import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { DivergenceSummary } from "@/lib/conciliationDivergences";

export function useConcDivergenceSummary(hotelId?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conc-divergence-summary", user?.id, hotelId ?? "linked"],
    enabled: enabled && !!user,
    queryFn: async (): Promise<DivergenceSummary[]> => {
      const { data, error } = await supabase.rpc("conc_divergence_summary", { p_hotel: hotelId });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

export function useSendConcDivergences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hotelId: string) => {
      const { data, error } = await supabase.rpc("conc_send_divergences", { p_hotel: hotelId });
      if (error) throw error;
      return data as { queued: number; empty?: boolean; already_pending?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-queue"] });
      qc.invalidateQueries({ queryKey: ["notification-count-pending"] });
      qc.invalidateQueries({ queryKey: ["conc-divergence-summary"] });
    },
  });
}