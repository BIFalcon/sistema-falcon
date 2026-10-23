import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useConcJustifications, useSaveJustification, type ConcKind, type ConcSide } from "@/hooks/useConciliacaoCartao";
import { useConcDivergenceSummary } from "@/hooks/useConcDivergences";
import { JustificationsPanel } from "./JustificationsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/** Hotel-scoped RPC supplies pending rows without exposing reconciliation write controls. */
export function DivergencesPanel() {
  const [params] = useSearchParams();
  const { allowedHotels } = useAuth();
  const filters = useModuleFilters("financeiro");
  const hotelId = params.get("hotel") || filters.hotelId || allowedHotels[0]?.id;
  const summary = useConcDivergenceSummary(hotelId, !!hotelId);
  const notes = useConcJustifications(hotelId ?? null);
  const save = useSaveJustification();
  const entries = useQuery({
    queryKey: ["conc-divergence-items", hotelId], enabled: !!hotelId,
    queryFn: async () => {
      if (!hotelId) return [];
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.rpc("conc_divergence_items", { p_hotel: hotelId })
          .order("date").order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
  if (!hotelId) return <p className="text-sm text-muted-foreground">Selecione um hotel.</p>;
  if (entries.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (entries.error || summary.error) return <p role="alert" className="text-destructive">Não foi possível carregar as pendências deste hotel.</p>;
  const s = summary.data?.[0];
  const groups: { value: ConcKind; label: string }[] = [
    { value: "cartao", label: "Cartão" }, { value: "pix_extrato", label: "PIX" }, { value: "dinheiro", label: "Dinheiro" },
  ];
  return <div className="space-y-4">
    <h2 className="text-lg font-semibold">Pendências — {s?.hotel_name}</h2>
    <Tabs defaultValue="cartao">
      <TabsList>{groups.map(g => <TabsTrigger key={g.value} value={g.value}>{g.label}</TabsTrigger>)}</TabsList>
      {groups.map(g => <TabsContent key={g.value} value={g.value}>
        <JustificationsPanel kind={g.value} saving={save.isPending} justifications={notes.data ?? []}
          rows={(entries.data ?? []).filter(e => e.kind === g.value).map(e => ({ ...e, side: e.side as ConcSide, amount: Number(e.amount) }))}
          onSave={(row, note) => save.mutate({ hotelId, entryId: row.id, side: row.side, kind: g.value, note }, {
            onSuccess: () => toast.success("Justificativa salva"), onError: (e: Error) => toast.error(e.message),
          })} />
      </TabsContent>)}
    </Tabs>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-sm">Faturamento inadimplente: <strong>{s?.inadimplente ?? "—"}</strong></p>
      <Button variant="outline" asChild><Link to={`/financeiro/contas-receber?hotel=${encodeURIComponent(hotelId)}&status=inadimplente`}>Ver faturamento</Link></Button>
    </div>
  </div>;
}