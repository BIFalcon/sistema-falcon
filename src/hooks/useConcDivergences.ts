import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { DivergenceSummary, DivergenceItem } from "@/lib/conciliationDivergences";

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
    mutationFn: async ({ hotelId, keys }: { hotelId: string; keys: string[] }) => {
      const { data, error } = await supabase.rpc("conc_send_divergences_selected", { p_hotel: hotelId, p_keys: keys });
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

export function useSendableDivergences(hotelId: string, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conc-sendable-divergences", user?.id, hotelId], enabled: enabled && !!user,
    queryFn: async (): Promise<DivergenceItem[]> => {
      const rows: DivergenceItem[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.rpc("conc_notification_items", { p_hotel: hotelId })
          .order("kind").order("side").order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []).map(row => ({ ...row, amount: Number(row.amount) })));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}