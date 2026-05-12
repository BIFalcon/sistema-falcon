import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NotificationEvent =
  | "dre_first_preview"
  | "dre_comment"
  | "dre_new_preview"
  | "dre_controladoria_approved"
  | "dre_gop_approved"
  | "dre_fernando_approved"
  | "dre_returned"
  | "carta_gg_approved"
  | "carta_comment"
  | "carta_gop_approved"
  | "carta_fernando_approved"
  | "carta_returned";

export type NotificationStatus = "pending" | "dispatched" | "failed" | "skipped";

export interface NotificationRow {
  id: string;
  event: NotificationEvent;
  closing_id: string;
  hotel_id: string;
  recipient_user_id: string;
  recipient_email: string | null;
  recipient_role: string | null;
  subject: string;
  body_md: string;
  link_url: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  scheduled_at: string;
  dispatched_at: string | null;
  error_message: string | null;
  created_at: string;
}

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  dre_first_preview: "DRE — 1ª prévia",
  dre_new_preview: "DRE — nova prévia",
  dre_comment: "DRE — comentário",
  dre_controladoria_approved: "DRE — Controladoria aprovou",
  dre_gop_approved: "DRE — GOP aprovou",
  dre_fernando_approved: "DRE — Fernando aprovou",
  dre_returned: "DRE — devolvida",
  carta_gg_approved: "Carta — GG aprovou",
  carta_comment: "Carta — comentário",
  carta_gop_approved: "Carta — GOP aprovou",
  carta_fernando_approved: "Carta — Fernando aprovou",
  carta_returned: "Carta — devolvida",
};

export function useNotificationQueue(params?: {
  status?: NotificationStatus;
  recipientUserId?: string;
}) {
  return useQuery({
    queryKey: [
      "notification-queue",
      params?.status ?? "all",
      params?.recipientUserId ?? "all",
    ],
    queryFn: async (): Promise<NotificationRow[]> => {
      let q = supabase
        .from("notification_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (params?.status) q = q.eq("status", params.status);
      if (params?.recipientUserId) q = q.eq("recipient_user_id", params.recipientUserId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });
}

export function useProcessNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("process-notifications");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-queue"] });
    },
  });
}

/** Conta notificações pendentes para o usuário logado (refetch a cada 30s). */
export function usePendingNotificationCount() {
  const { data: user } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  return useQuery({
    queryKey: ["notification-count-pending", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from("notification_queue")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", user.id)
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });
}
