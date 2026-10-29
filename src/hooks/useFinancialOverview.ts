import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FinancialOverviewRow, FinancialPeriod } from "@/lib/financialOverview";

export function useFinancialOverview(hotelIds: string[], period: FinancialPeriod, userId: string | undefined) {
  return useQuery({
    queryKey: ["financial-overview", userId, [...hotelIds].sort(), period],
    enabled: !!userId && hotelIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<FinancialOverviewRow[]> => {
      const { data, error } = await supabase.rpc("financial_overview" as never, {
        p_hotel_ids: hotelIds,
        p_date_from: period.specificDates.length ? null : period.dateFrom || null,
        p_date_to: period.specificDates.length ? null : period.dateTo || null,
        p_dates: period.specificDates.length ? period.specificDates : null,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as FinancialOverviewRow[];
    },
  });
}