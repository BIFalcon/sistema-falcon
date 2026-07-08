import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClosingStage } from "@/lib/constants";

export interface CommentRow {
  id: string;
  closing_id: string;
  stage: ClosingStage;
  author_id: string;
  content: string;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  author?: { display_name: string | null; email: string | null } | null;
}

export function useComments(closingId: string | null | undefined, stage: ClosingStage) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["comments", closingId, stage],
    queryFn: async (): Promise<CommentRow[]> => {
      if (!closingId) return [];
      const { data, error } = await supabase
        .from("comments")
        .select("*")
        .eq("closing_id", closingId)
        .eq("stage", stage)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as CommentRow[];
      const ids = Array.from(new Set(rows.map((r) => r.author_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", ids);
        const map = new Map((profs ?? []).map((p) => [p.user_id, p]));
        for (const r of rows) {
          const p = map.get(r.author_id);
          r.author = p ? { display_name: p.display_name, email: p.email } : null;
        }
      }
      return rows;
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      closingId: string;
      stage: ClosingStage;
      content: string;
      userId: string;
      attachmentUrl?: string | null;
      attachmentName?: string | null;
    }) => {
      const { error } = await supabase.from("comments").insert({
        closing_id: input.closingId,
        stage: input.stage,
        content: input.content,
        author_id: input.userId,
        attachment_url: input.attachmentUrl ?? null,
        attachment_name: input.attachmentName ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["comments", vars.closingId, vars.stage] });
    },
  });
}