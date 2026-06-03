import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/constants";

export type UserStatus = "active" | "pending" | "banned";

export interface ManagedUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  status: UserStatus;
  created_at: string;
  roles: AppRole[];
  hotel_ids: string[];
  is_master: boolean;
  is_protected: boolean; // processos ou fernando — não pode ser desativado
  /** Sub-papel do financeiro: equipe (ops) ou coordenadora. Apenas relevante se roles inclui 'financeiro'. */
  financeiro_subrole: "equipe" | "coordenadora" | null;
}

export function useManagedUsers() {
  return useQuery({
    queryKey: ["managed-users"],
    queryFn: async (): Promise<ManagedUser[]> => {
      const [{ data: profiles, error: pErr }, { data: roles }, { data: hotels }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("user_id, email, display_name, status, created_at, financeiro_subrole")
            .order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id, role"),
          supabase.from("user_hotels").select("user_id, hotel_id"),
        ]);

      if (pErr) throw pErr;

      const rolesByUser = new Map<string, AppRole[]>();
      (roles ?? []).forEach((r) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role as AppRole);
        rolesByUser.set(r.user_id, arr);
      });

      const hotelsByUser = new Map<string, string[]>();
      (hotels ?? []).forEach((h) => {
        const arr = hotelsByUser.get(h.user_id) ?? [];
        arr.push(h.hotel_id);
        hotelsByUser.set(h.user_id, arr);
      });

      return (profiles ?? []).map((p): ManagedUser => {
        const rs = rolesByUser.get(p.user_id) ?? [];
        const isMaster = rs.includes("processos");
        const isProtected = rs.includes("processos");
        return {
          user_id: p.user_id,
          email: p.email,
          display_name: p.display_name,
          status: p.status as UserStatus,
          created_at: p.created_at,
          roles: rs,
          hotel_ids: hotelsByUser.get(p.user_id) ?? [],
          is_master: isMaster,
          is_protected: isProtected,
          financeiro_subrole:
            ((p as { financeiro_subrole?: string | null }).financeiro_subrole as
              | "equipe"
              | "coordenadora"
              | null) ?? null,
        };
      });
    },
  });
}

/** Atualiza apenas o sub-papel do financeiro (equipe / coordenadora) no profile. */
export function useSetFinanceiroSubrole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; subrole: "equipe" | "coordenadora" | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ financeiro_subrole: input.subrole })
        .eq("user_id", input.user_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managed-users"] }),
  });
}

interface InvitePayload {
  email: string;
  display_name: string;
  is_master: boolean;
  primary_role?: AppRole;
  hotel_ids?: string[];
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InvitePayload) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "invite", ...payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { user_id: string; invite_link: string | null; email_queued?: boolean };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managed-users"] }),
  });
}

interface UpdatePayload {
  user_id: string;
  display_name?: string;
  is_master: boolean;
  primary_role?: AppRole;
  hotel_ids?: string[];
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdatePayload) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "update", ...payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managed-users"] }),
  });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { user_id: string; status: "active" | "banned" }) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "set_status", ...payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managed-users"] }),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: async (user_id: string) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "resend_invite", user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { invite_link: string | null; email_queued?: boolean };
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (user_id: string) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "delete_user", user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managed-users"] }),
  });
}