import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DailyClosingRow } from "@/lib/dailyBankClosing";

export interface BankPending {
  id: string; entry_id: string; day: string; description: string | null; valor: number;
  status: "aberta" | "revertida"; aberta_em: string; revertida_em: string | null; match_id: string | null;
}
export function useDailyBankClosing(hotelId: string | null, from: string, to: string, dates: string[]) {
  return useQuery({
    queryKey: ["conc-daily-closing", hotelId, from, to, dates.join(",")], enabled: !!hotelId,
    queryFn: async () => {
      if (!hotelId) throw new Error("Selecione um hotel");
      const { data, error } = await supabase.rpc("conc_daily_closing", {
        p_hotel: hotelId, p_from: from || undefined, p_to: to || undefined, p_dates: dates.length ? dates : undefined,
      });
      if (error) throw error;
      return data as unknown as { days: DailyClosingRow[]; pending: BankPending[] };
    },
    refetchInterval: 10000,
  });
}
export function useSaveDailyBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; day: string; initial: number | null; real: number | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Entre novamente no sistema");
      const { error } = await supabase.from("conc_daily_balances").upsert({
        hotel_id: input.hotelId, account_name: "*", balance_date: input.day,
        initial_balance: input.initial, real_balance: input.real, source: "manual", informed_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "hotel_id,account_name,balance_date" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["conc-daily-closing"] }); },
  });
}