import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ArClient {
  id: string;
  hotel_id: string;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  payment_term_days: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useArClients(hotelId: string | null) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["ar-clients", hotelId],
    queryFn: async (): Promise<ArClient[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("ar_clients")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ArClient[];
    },
  });
}

export function useUpsertArClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      hotel_id: string;
      name: string;
      cnpj_cpf?: string | null;
      email?: string | null;
      payment_term_days: number;
      notes?: string | null;
    }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Não autenticado");
      if (input.id) {
        const { error } = await supabase
          .from("ar_clients")
          .update({
            name: input.name,
            cnpj_cpf: input.cnpj_cpf ?? null,
            email: input.email ?? null,
            payment_term_days: input.payment_term_days,
            notes: input.notes ?? null,
          })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ar_clients").insert({
          hotel_id: input.hotel_id,
          name: input.name,
          cnpj_cpf: input.cnpj_cpf ?? null,
          email: input.email ?? null,
          payment_term_days: input.payment_term_days,
          notes: input.notes ?? null,
          created_by: uid,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ar-clients", v.hotel_id] }),
  });
}

export function useDeleteArClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; hotel_id: string }) => {
      const { error } = await supabase.from("ar_clients").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ar-clients", v.hotel_id] }),
  });
}