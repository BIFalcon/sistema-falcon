import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClosingStatus, ClosingStage } from "@/lib/constants";

export interface PerfClosing {
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

export interface StatusLogEntry {
  id: string;
  closing_id: string;
  field: string;
  old_value: ClosingStatus | null;
  new_value: ClosingStatus;
  changed_by: string | null;
  changed_by_name?: string | null;
  created_at: string;
}

export interface CommentEntry {
  id: string;
  closing_id: string;
  stage: ClosingStage;
  author_id: string;
  author_name?: string | null;
  content: string;
  created_at: string;
}

export interface ApprovalEntry {
  id: string;
  closing_id: string;
  stage: ClosingStage;
  status: ClosingStatus;
  approved_by: string;
  approved_by_name?: string | null;
  notes: string | null;
  created_at: string;
}

export interface DreVersionEntry {
  id: string;
  closing_id: string;
  version_number: number;
  file_name: string;
  author_id: string;
  author_name?: string | null;
  created_at: string;
}

/**
 * Lista todos os fechamentos do período (escopo do RLS).
 */
export function usePerfClosings(month: number, year: number) {
  return useQuery({
    queryKey: ["perf-closings", year, month],
    queryFn: async (): Promise<PerfClosing[]> => {
      const { data, error } = await supabase
        .from("closings")
        .select(
          "id,hotel_id,month,year,status_dre,status_carta,status_financeiro,status_envio,dre_started_at,dre_approved_at,carta_started_at,carta_approved_at,financeiro_started_at,financeiro_resolved_at,envio_sent_at,created_at,updated_at",
        )
        .eq("month", month)
        .eq("year", year);
      if (error) throw error;
      return (data ?? []) as PerfClosing[];
    },
  });
}

/**
 * Busca timeline completa de um fechamento (status log + comentários + aprovações + versões DRE).
 */
export function useClosingTimeline(closingId: string | null) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["closing-timeline", closingId],
    queryFn: async () => {
      if (!closingId) return null;
      const [logsRes, commentsRes, approvalsRes, versionsRes] = await Promise.all([
        supabase
          .from("closing_status_log")
          .select("*")
          .eq("closing_id", closingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("comments")
          .select("*")
          .eq("closing_id", closingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("approvals")
          .select("*")
          .eq("closing_id", closingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("dre_versions")
          .select("*")
          .eq("closing_id", closingId)
          .order("created_at", { ascending: true }),
      ]);

      if (logsRes.error) throw logsRes.error;
      if (commentsRes.error) throw commentsRes.error;
      if (approvalsRes.error) throw approvalsRes.error;
      if (versionsRes.error) throw versionsRes.error;

      const userIds = new Set<string>();
      logsRes.data?.forEach((l) => l.changed_by && userIds.add(l.changed_by));
      commentsRes.data?.forEach((c) => userIds.add(c.author_id));
      approvalsRes.data?.forEach((a) => userIds.add(a.approved_by));
      versionsRes.data?.forEach((v) => userIds.add(v.author_id));

      const ids = Array.from(userIds);
      const profilesMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id,display_name,email")
          .in("user_id", ids);
        profs?.forEach((p) => {
          profilesMap.set(p.user_id, p.display_name || p.email || p.user_id);
        });
      }

      const decorate = <T extends { changed_by?: string | null; author_id?: string; approved_by?: string }>(
        rows: T[],
        key: "changed_by" | "author_id" | "approved_by",
        outKey: "changed_by_name" | "author_name" | "approved_by_name",
      ) =>
        rows.map((r) => {
          const id = r[key] as string | null | undefined;
          return { ...r, [outKey]: id ? profilesMap.get(id) ?? null : null };
        });

      return {
        logs: decorate((logsRes.data ?? []) as StatusLogEntry[], "changed_by", "changed_by_name") as StatusLogEntry[],
        comments: decorate((commentsRes.data ?? []) as CommentEntry[], "author_id", "author_name") as CommentEntry[],
        approvals: decorate((approvalsRes.data ?? []) as ApprovalEntry[], "approved_by", "approved_by_name") as ApprovalEntry[],
        versions: decorate((versionsRes.data ?? []) as DreVersionEntry[], "author_id", "author_name") as DreVersionEntry[],
      };
    },
  });
}

/**
 * Carrega TODOS os logs/aprovações do período para calcular ranking de usuários.
 */
export function usePerfActivity(closingIds: string[]) {
  return useQuery({
    enabled: closingIds.length > 0,
    queryKey: ["perf-activity", closingIds.sort().join(",")],
    queryFn: async () => {
      const [logsRes, approvalsRes, commentsRes] = await Promise.all([
        supabase
          .from("closing_status_log")
          .select("*")
          .in("closing_id", closingIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("approvals")
          .select("*")
          .in("closing_id", closingIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("comments")
          .select("*")
          .in("closing_id", closingIds)
          .order("created_at", { ascending: true }),
      ]);
      if (logsRes.error) throw logsRes.error;
      if (approvalsRes.error) throw approvalsRes.error;
      if (commentsRes.error) throw commentsRes.error;

      const userIds = new Set<string>();
      logsRes.data?.forEach((l) => l.changed_by && userIds.add(l.changed_by));
      approvalsRes.data?.forEach((a) => userIds.add(a.approved_by));
      commentsRes.data?.forEach((c) => userIds.add(c.author_id));

      const ids = Array.from(userIds);
      const profilesMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id,display_name,email")
          .in("user_id", ids);
        profs?.forEach((p) => {
          profilesMap.set(p.user_id, p.display_name || p.email || p.user_id);
        });
      }

      return {
        logs: (logsRes.data ?? []) as StatusLogEntry[],
        approvals: (approvalsRes.data ?? []) as ApprovalEntry[],
        comments: (commentsRes.data ?? []) as CommentEntry[],
        profilesMap,
      };
    },
  });
}