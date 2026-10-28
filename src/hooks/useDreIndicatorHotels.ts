import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Hotel } from "@/contexts/AuthContext";
import { usesNetworkDreHotels } from "@/lib/dreAccess";

/** Hotels selectable in Indicadores DRE (GOP: whole network; others: their usual list). */
export function useDreIndicatorHotels(enabled = true): Hotel[] {
  const { allowedHotels, roles, isMaster, user } = useAuth();
  const network = enabled && usesNetworkDreHotels(roles, isMaster);
  const { data } = useQuery({
    enabled: network && !!user,
    queryKey: ["dre-indicator-hotels", user?.id],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_dre_indicator_hotels");
      if (error) throw error;
      return (data ?? []) as Hotel[];
    },
  });
  return network && data && data.length > 0 ? data : allowedHotels;
}
