import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export async function fetchSystemAlerts() {
  const { data, count, error } = await supabase
    .from("system_alerts")
    .select("id, type, message, created_at", { count: "exact" })
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return { alerts: data ?? [], total: count ?? 0 };
}

export async function resolveSystemAlert(id: string) {
  const { data, error } = await supabase
    .from("system_alerts")
    .update({ resolved: true })
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw error;
  if (!data || data.id !== id) throw new Error("O alerta não foi atualizado.");
  return data.id;
}

export function useSystemAlerts(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["system-alerts"],
    enabled,
    queryFn: fetchSystemAlerts,
    staleTime: 5 * 60 * 1000,
  });
  const resolve = useMutation({
    mutationFn: resolveSystemAlert,
    onSuccess: async () => {
      toast.success("Alerta encerrado.");
      await queryClient.invalidateQueries({ queryKey: ["system-alerts"] });
    },
    onError: () => toast.error("Não foi possível encerrar o alerta. Tente novamente."),
  });
  return { ...query, resolve };
}