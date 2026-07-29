import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HotelContexto {
  id: string;
  hotel_id: string;
  respondido_por: string | null;
  respondido_em: string | null;
  quem_sustenta_hotel: string | null;
  mudanca_praca: string | null;
  atrapalha_operacao: string | null;
  desconto_frequente: string | null;
  prioridade_3_meses: string | null;
  ultima_confirmacao_em: string | null;
  sem_mudancas_desde_ultima: boolean | null;
  created_at: string;
  updated_at: string;
}

export type ContextoAnswers = Pick<
  HotelContexto,
  | "quem_sustenta_hotel"
  | "mudanca_praca"
  | "atrapalha_operacao"
  | "desconto_frequente"
  | "prioridade_3_meses"
>;

export const CONTEXTO_QUESTIONS: { field: keyof ContextoAnswers; label: string; hint: string }[] = [
  {
    field: "quem_sustenta_hotel",
    label: "1. Quem sustenta o hotel hoje?",
    hint: "Quais são as fontes de demanda mais importantes e onde existe dependência (empresas, eventos, OTAs, grupos…).",
  },
  {
    field: "mudanca_praca",
    label: "2. O que mudou na praça nos últimos meses?",
    hint: "Novos concorrentes, obras, eventos, mudanças de perfil de público, alterações de preço no mercado.",
  },
  {
    field: "atrapalha_operacao",
    label: "3. O que atrapalha o resultado e não aparece em número?",
    hint: "Estrutura, equipe, manutenção, processos, limitações do prédio, etc.",
  },
  {
    field: "desconto_frequente",
    label: "4. Precisa dar desconto? Quando e por quê?",
    hint: "Em que situações o hotel abre mão de tarifa e qual a razão por trás disso.",
  },
  {
    field: "prioridade_3_meses",
    label: "5. Se pudesse resolver uma coisa nos próximos 3 meses, o que seria?",
    hint: "A prioridade número um na sua visão de gestor.",
  },
];

export function useHotelContexto(hotelId: string | null | undefined) {
  return useQuery({
    queryKey: ["hotel-contexto", hotelId],
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hotel_contexto")
        .select("*")
        .eq("hotel_id", hotelId!)
        .maybeSingle();
      if (error) throw error;
      return (data as HotelContexto | null) ?? null;
    },
  });
}

/** Contexto de todos os hotéis visíveis ao usuário (usado no banner e no export). */
export function useAllHotelContextos(enabled = true) {
  return useQuery({
    queryKey: ["hotel-contexto", "all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("hotel_contexto").select("*");
      if (error) throw error;
      return (data ?? []) as HotelContexto[];
    },
  });
}

interface SaveArgs {
  hotelId: string;
  answers: Partial<ContextoAnswers>;
  /** true = "Enviar respostas" (marca respondido_em) */
  finalize?: boolean;
}

export function useSaveHotelContexto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ hotelId, answers, finalize }: SaveArgs) => {
      const { data: userRes } = await supabase.auth.getUser();
      const payload: Record<string, unknown> = {
        hotel_id: hotelId,
        ...answers,
      };
      if (finalize) {
        payload.respondido_em = new Date().toISOString();
        payload.respondido_por = userRes.user?.id ?? null;
        payload.ultima_confirmacao_em = new Date().toISOString();
        payload.sem_mudancas_desde_ultima = null;
      }
      const { error } = await supabase
        .from("hotel_contexto")
        .upsert(payload as never, { onConflict: "hotel_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotel-contexto"] });
    },
  });
}

/** "Não, continua igual" no refresh semestral. */
export function useConfirmNoChanges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hotelId: string) => {
      const { error } = await supabase
        .from("hotel_contexto")
        .update({
          ultima_confirmacao_em: new Date().toISOString(),
          sem_mudancas_desde_ultima: true,
        })
        .eq("hotel_id", hotelId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-contexto"] }),
  });
}

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 183;

export function needsRefresh(ctx: HotelContexto | null | undefined): boolean {
  if (!ctx?.respondido_em) return false;
  const last = new Date(ctx.ultima_confirmacao_em ?? ctx.respondido_em).getTime();
  return Date.now() - last > SIX_MONTHS_MS;
}

export function isAnswered(ctx: HotelContexto | null | undefined): boolean {
  return !!ctx?.respondido_em;
}
