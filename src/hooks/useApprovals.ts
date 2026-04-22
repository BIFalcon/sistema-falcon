import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClosingStage, ClosingStatus } from "@/lib/constants";

export interface ApprovalRow {
  id: string;
  closing_id: string;
  stage: ClosingStage;
  approved_by: string;
  status: ClosingStatus;
  notes: string | null;
  created_at: string;
  approver?: { display_name: string | null; email: string | null } | null;
}

export function useApprovals(closingId: string | null | undefined, stage: ClosingStage) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["approvals", closingId, stage],
    queryFn: async (): Promise<ApprovalRow[]> => {
      if (!closingId) return [];
      const { data, error } = await supabase
        .from("approvals")
        .select("*")
        .eq("closing_id", closingId)
        .eq("stage", stage)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as ApprovalRow[];
      const ids = Array.from(new Set(rows.map((r) => r.approved_by)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", ids);
        const map = new Map((profs ?? []).map((p) => [p.user_id, p]));
        for (const r of rows) {
          const p = map.get(r.approved_by);
          r.approver = p ? { display_name: p.display_name, email: p.email } : null;
        }
      }
      return rows;
    },
  });
}

export function useRecordApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      closingId: string;
      stage: ClosingStage;
      status: ClosingStatus;
      notes?: string;
      userId: string;
    }) => {
      const { error } = await supabase.from("approvals").insert({
        closing_id: input.closingId,
        stage: input.stage,
        status: input.status,
        notes: input.notes ?? null,
        approved_by: input.userId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["approvals", vars.closingId, vars.stage] });
    },
  });
}