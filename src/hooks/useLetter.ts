import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InvestorLetter {
  id: string;
  closing_id: string;
  highlight_market: string | null;
  highlight_operations: string | null;
  highlight_revenue: string | null;
  highlight_costs: string | null;
  highlight_outlook: string | null;
  custom_notes: string | null;
  ai_intro: string | null;
  ai_market_context: string | null;
  ai_operational: string | null;
  ai_financial: string | null;
  ai_outlook: string | null;
  ai_closing: string | null;
  ai_model: string | null;
  ai_generated_at: string | null;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  pdf_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useLetter(closingId: string | null | undefined) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["letter", closingId],
    queryFn: async (): Promise<InvestorLetter | null> => {
      if (!closingId) return null;
      const { data, error } = await supabase
        .from("investor_letters")
        .select("*")
        .eq("closing_id", closingId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as InvestorLetter | null;
    },
  });
}

export function useEnsureLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { closingId: string; userId: string }): Promise<InvestorLetter> => {
      const existing = await supabase
        .from("investor_letters")
        .select("*")
        .eq("closing_id", input.closingId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return existing.data as InvestorLetter;
      const { data, error } = await supabase
        .from("investor_letters")
        .insert({ closing_id: input.closingId, created_by: input.userId })
        .select("*")
        .single();
      if (error) throw error;
      return data as InvestorLetter;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter", v.closingId] }),
  });
}

export function useUpdateLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; closingId: string; patch: Partial<InvestorLetter> }) => {
      const { error } = await supabase
        .from("investor_letters")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(input.patch as any)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter", v.closingId] }),
  });
}

/**
 * Chama edge function que usa Lovable AI para gerar a narrativa da carta.
 */
export function useGenerateLetterAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { closingId: string; letterId: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-letter", {
        body: { closing_id: input.closingId, letter_id: input.letterId },
      });
      if (error) throw error;
      return data as { ok: boolean; model: string };
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter", v.closingId] }),
  });
}

export async function getLetterPdfSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("investor-letters").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}