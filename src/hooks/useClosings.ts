import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { ClosingStatus } from "@/lib/constants";

export interface ClosingRow {
  id: string;
  hotel_id: string;
  month: number;
  year: number;
  status_dre: ClosingStatus;
  status_carta: ClosingStatus;
  status_financeiro: ClosingStatus;
  status_envio: ClosingStatus;
  dre_started_at: string | null;
  dre_approved_at: string | null;
  carta_started_at: string | null;
  carta_approved_at: string | null;
  financeiro_started_at: string | null;
  financeiro_resolved_at: string | null;
  envio_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lista os fechamentos de um período (mês/ano), opcionalmente filtrando por hotel.
 * RLS já restringe ao escopo do usuário.
 */
export function useClosings(params: { month: number; year: number; hotelId?: string | null }) {
  const { month, year, hotelId } = params;
  return useQuery({
    queryKey: ["closings", year, month, hotelId ?? "all"],
    queryFn: async (): Promise<ClosingRow[]> => {
      let q = supabase
        .from("closings")
        .select("*")
        .eq("month", month)
        .eq("year", year)
        .order("hotel_id");
      if (hotelId) q = q.eq("hotel_id", hotelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClosingRow[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * Recupera (ou cria sob demanda) o fechamento para hotel × mês × ano.
 */
export function useEnsureClosing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hotelId: string; month: number; year: number }): Promise<ClosingRow> => {
      const { hotelId, month, year } = input;
      const existing = await supabase
        .from("closings")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("month", month)
        .eq("year", year)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return existing.data as ClosingRow;
      const { data, error } = await supabase
        .from("closings")
        .insert({ hotel_id: hotelId, month, year })
        .select("*")
        .single();
      if (error) throw error;
      return data as ClosingRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["closings"] });
    },
  });
}

/**
 * Busca um único fechamento por id.
 */
export function useClosing(closingId: string | null | undefined) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["closing", closingId],
    queryFn: async (): Promise<ClosingRow | null> => {
      if (!closingId) return null;
      const { data, error } = await supabase
        .from("closings")
        .select("*")
        .eq("id", closingId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ClosingRow | null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Atualiza o status_dre de um fechamento. Triggers no banco cuidam dos timestamps e do log.
 */
export function useUpdateClosingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      closingId: string;
      field: "status_dre" | "status_carta" | "status_financeiro" | "status_envio";
      value: ClosingStatus;
    }) => {
      const { closingId, field, value } = input;
      // typed payload for each known field
      const payload: Record<string, unknown> = { [field]: value };
      const { error } = await supabase
        .from("closings")
        .update(payload as TablesUpdate<"closings">)
        .eq("id", closingId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
      qc.invalidateQueries({ queryKey: ["status-log", vars.closingId] });
    },
  });
}