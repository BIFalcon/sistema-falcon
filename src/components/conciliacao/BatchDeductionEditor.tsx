import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { SettlementBatch } from "@/lib/settlementBatch";
import { fmtBRL } from "@/lib/formatters";
export function BatchDeductionEditor({ hotelId, batch }: { hotelId: string; batch: SettlementBatch }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: async () => {
    const { error } = await supabase.rpc("conc_allocate_rede_deductions", { p_hotel: hotelId, p_receipt: batch.id, p_components: selected, p_note: note });
    if (error) throw error;
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["settlement-batch"] }); setSelected([]); setNote(""); toast.success("Descontos vinculados à composição. A baixa ainda exige todas as vendas conciliadas."); }, onError: e => toast.error(e.message) });
  if (batch.source !== "rede") return null;
  const candidates = batch.deduction_candidates ?? [];
  return <section className="space-y-2 border-t border-border pt-3">
    <p className="text-sm font-medium">Parcelas {fmtBRL(batch.net ?? 0)} − descontos vinculados {fmtBRL(batch.deduction_total ?? 0)} = {fmtBRL(batch.settlement_net ?? batch.net ?? 0)} · diferença {fmtBRL(batch.difference ?? 0)}</p>
    {(batch.deductions ?? []).map(d => <p key={d.id} className="text-xs">− {fmtBRL(d.amount)} · {d.label} · NSU {d.nsu || "—"} · {d.note}</p>)}
    {!batch.complete && candidates.length > 0 && <><h4 className="text-sm font-semibold">Descontos do relatório aguardando comprovação de vínculo</h4>{candidates.map(c => <label key={c.id} className="flex items-start gap-2 text-sm"><Checkbox disabled={c.allocated || save.isPending} checked={selected.includes(c.id)} onCheckedChange={v => setSelected(old => v === true ? [...old, c.id] : old.filter(id => id !== c.id))} /><span>{c.label} · NSU {c.nsu || "—"} · − {fmtBRL(c.amount)}{c.allocated ? " · já utilizado" : ""}</span></label>)}<Textarea aria-label="Comprovação dos descontos" placeholder="Justificativa e comprovação de que estes descontos pertencem a este recebimento" value={note} onChange={e => setNote(e.target.value)} /><Button variant="outline" size="sm" disabled={!selected.length || note.trim().length < 10 || save.isPending} onClick={() => save.mutate()}>Confirmar vínculo dos descontos</Button></>}
  </section>;
}