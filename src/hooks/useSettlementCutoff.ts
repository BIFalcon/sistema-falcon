import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SettlementItem, SettlementProvider } from "@/lib/settlementCutoff";

export function useSettlementCutoff(hotelId: string, provider: SettlementProvider) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["settlement-cutoff", hotelId, provider],
    queryFn: async () => {
      const [cutoff, items, history] = await Promise.all([
        supabase.from("conc_settlement_cutoffs").select("cutoff_date").eq("hotel_id", hotelId).eq("provider", provider).maybeSingle(),
        supabase.rpc("conc_settlement_items", { p_hotel: hotelId, p_provider: provider }),
        supabase.from("conc_settlement_transitions").select("*").eq("hotel_id", hotelId).eq("provider", provider).order("created_at", { ascending: false }),
      ]);
      if (cutoff.error) throw cutoff.error;
      if (items.error) throw items.error;
      if (history.error) throw history.error;
      return { cutoff: cutoff.data?.cutoff_date ?? null, items: (items.data ?? []) as SettlementItem[], history: history.data ?? [] };
    },
  });
  const invalidate = () => {
    for (const key of ["settlement-cutoff", "conc-b2b-baixa", "conc-rede-receb", "conc-bank", "conc-daily-closing", "conc-divergences", "conc-divergence-summary"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const save = useMutation({
    mutationFn: async (date: string) => {
      if (!user) throw new Error("Entre novamente para salvar.");
      if (!date) throw new Error("Informe uma data válida.");
      const { error } = await supabase.from("conc_settlement_cutoffs").upsert({ hotel_id: hotelId, provider, cutoff_date: date, updated_by: user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
    }, onSuccess: invalidate,
  });
  const transition = useMutation({
    mutationFn: async ({ items, note }: { items: SettlementItem[]; note: string }) => {
      const { data, error } = await supabase.rpc("conc_settlement_transition", { p_hotel: hotelId, p_provider: provider, p_items: items.map(({ source, entry_id }) => ({ source, entry_id })), p_note: note });
      if (error) throw error;
      return data;
    }, onSuccess: invalidate,
  });
  const undo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("conc_settlement_transition_undo", { p_id: id });
      if (error) throw error;
    }, onSuccess: invalidate,
  });
  return { ...query, save, transition, undo };
}