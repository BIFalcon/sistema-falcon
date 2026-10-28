import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BankPending } from "@/hooks/useDailyBankClosing";

export interface TransitDetails {
  cycle: BankPending;
  bank?: { id: string; date: string; description: string; amount: number; account: string; matched_at: string | null };
  type: string;
  reason: string;
  matches: { id: string; kind: string; note: string | null }[];
  opera: { id: string; business_date: string; amount: number; guest_full_name: string; room: string; receipt_no: string }[];
  candidates: { id: string; date: string; amount: number; guest: string; room: string; receipt: string; category: string; matched_at: string | null }[];
}
export function useBankTransit(hotelId: string, pending: BankPending | null) {
  return useQuery({ queryKey: ["bank-transit", hotelId, pending?.id], enabled: !!pending, queryFn: async () => {
    if (!pending) throw new Error("Selecione uma pendência");
    const { data, error } = await supabase.rpc("conc_bank_transit_details", { p_hotel: hotelId, p_pending: pending.id });
    if (error) throw error;
    return data as unknown as TransitDetails;
  } });
}