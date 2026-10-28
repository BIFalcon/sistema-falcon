import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export function useBankReceiptRules(hotelId: string) {
  return useQuery({ queryKey: ["bank-receipt-rules", hotelId], queryFn: async () => {
    const { data, error } = await supabase.from("conc_bank_receipt_rules").select("*").eq("hotel_id", hotelId).order("prefix");
    if (error) throw error;
    return data;
  } });
}