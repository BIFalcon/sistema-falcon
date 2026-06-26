import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ApCategoryMonthPoint {
  refYear: number;
  refMonth: number;
  totalAmount: number;
  entryCount: number;
}

export function useApCategoryMonthlySeries(
  hotelId: string | null | undefined,
  categoryNormalized?: string,
) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ap-category-series", hotelId, categoryNormalized],
    queryFn: async (): Promise<ApCategoryMonthPoint[]> => {
      const { data, error } = await supabase.rpc("get_ap_category_monthly_series", {
        _hotel_id: hotelId!,
        _category_normalized: categoryNormalized ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        refYear: Number(r.ref_year ?? 0),
        refMonth: Number(r.ref_month ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
        entryCount: Number(r.entry_count ?? 0),
      }));
    },
    staleTime: 15 * 60 * 1000,
  });
}