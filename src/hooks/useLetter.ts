import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";

export interface InvestorLetter {
  id: string;
  closing_id: string;
  // Campos legados (mantidos no banco, ocultos na UI)
  highlight_market: string | null;
  highlight_operations: string | null;
  highlight_revenue: string | null;
  highlight_costs: string | null;
  highlight_outlook: string | null;
  custom_notes: string | null;
  // Novos campos
  reserve_fund: number | null;
  rps_score: number | null;
  operational_comment: string | null;
  last_ai_instruction: string | null;
  ai_version_number: number;
  // IA
  ai_intro: string | null;
  ai_market_context: string | null;
  ai_operational: string | null;
  ai_financial: string | null;
  ai_outlook: string | null;
  ai_closing: string | null;
  ai_model: string | null;
  ai_generated_at: string | null;
  // PDF
  pdf_url: string | null;
  pdf_generated_at: string | null;
  pdf_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LetterHighlight {
  id: string;
  letter_id: string;
  closing_id: string;
  title: string;
  note: string | null;
  photo_url: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LetterVersion {
  id: string;
  letter_id: string;
  closing_id: string;
  version_number: number;
  ai_intro: string | null;
  ai_market_context: string | null;
  ai_operational: string | null;
  ai_financial: string | null;
  ai_outlook: string | null;
  ai_closing: string | null;
  ai_model: string | null;
  instruction: string | null;
  created_by: string | null;
  created_at: string;
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
        .update(input.patch as TablesUpdate<"investor_letters">)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter", v.closingId] }),
  });
}

/* ─────────── Destaques ─────────── */

export function useLetterHighlights(letterId: string | null | undefined) {
  return useQuery({
    enabled: !!letterId,
    queryKey: ["letter-highlights", letterId],
    queryFn: async (): Promise<LetterHighlight[]> => {
      if (!letterId) return [];
      const { data, error } = await supabase
        .from("letter_highlights")
        .select("*")
        .eq("letter_id", letterId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LetterHighlight[];
    },
  });
}

export function useCreateHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      letterId: string;
      closingId: string;
      userId: string;
      title: string;
      note?: string | null;
      photo_url?: string | null;
      sort_order: number;
    }) => {
      const { data, error } = await supabase
        .from("letter_highlights")
        .insert({
          letter_id: input.letterId,
          closing_id: input.closingId,
          created_by: input.userId,
          title: input.title,
          note: input.note ?? null,
          photo_url: input.photo_url ?? null,
          sort_order: input.sort_order,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as LetterHighlight;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter-highlights", v.letterId] }),
  });
}

export function useUpdateHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; letterId: string; patch: Partial<LetterHighlight> }) => {
      const { error } = await supabase
        .from("letter_highlights")
        .update(input.patch as TablesUpdate<"letter_highlights">)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter-highlights", v.letterId] }),
  });
}

export function useDeleteHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; letterId: string; photo_url: string | null }) => {
      if (input.photo_url) {
        await supabase.storage.from("letter-highlights").remove([input.photo_url]).catch(() => {});
      }
      const { error } = await supabase.from("letter_highlights").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["letter-highlights", v.letterId] }),
  });
}

export async function uploadHighlightPhoto(closingId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${closingId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("letter-highlights")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function getHighlightPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("letter-highlights").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ─────────── Versões IA ─────────── */

export function useLetterVersions(letterId: string | null | undefined) {
  return useQuery({
    enabled: !!letterId,
    queryKey: ["letter-versions", letterId],
    queryFn: async (): Promise<LetterVersion[]> => {
      if (!letterId) return [];
      const { data, error } = await supabase
        .from("letter_versions")
        .select("*")
        .eq("letter_id", letterId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LetterVersion[];
    },
  });
}

/**
 * Chama edge function que usa Lovable AI para (re)gerar a narrativa.
 * Aceita instrução adicional opcional para regeneração com comentário.
 */
export function useGenerateLetterAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      closingId: string;
      letterId: string;
      instruction?: string;
      manualText?: Pick<LetterVersion, "ai_intro" | "ai_market_context" | "ai_operational" | "ai_financial" | "ai_outlook" | "ai_closing">;
    }) => {
      const { data, error } = await supabase.functions.invoke("generate-letter", {
        body: {
          closing_id: input.closingId,
          letter_id: input.letterId,
          instruction: input.instruction ?? null,
          manual_text: input.manualText ? {
            intro: input.manualText.ai_intro,
            market_context: input.manualText.ai_market_context,
            operational: input.manualText.ai_operational,
            financial: input.manualText.ai_financial,
            outlook: input.manualText.ai_outlook,
            closing: input.manualText.ai_closing,
          } : undefined,
        },
      });
      if (error) throw error;
      return data as { ok: boolean; model: string; version: number };
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["letter", v.closingId] });
      qc.invalidateQueries({ queryKey: ["letter-versions", v.letterId] });
    },
  });
}

export async function getLetterPdfSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("investor-letters").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function downloadLetterPdfBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from("investor-letters").download(path);
  if (error || !data) throw error ?? new Error("Falha ao baixar PDF");
  return data;
}
