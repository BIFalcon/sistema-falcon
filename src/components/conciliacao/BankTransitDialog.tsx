import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useBankTransit } from "@/hooks/useBankTransit";
import type { BankPending } from "@/hooks/useDailyBankClosing";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { SettlementBatchDialog } from "./SettlementBatchDialog";
import { BoletoCreditDialog, type BoletoTarget } from "./BoletoCreditDialog";
import type { BatchTarget } from "@/hooks/useSettlementBatch";
import { fmtBRL } from "@/lib/formatters";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
const day = (d: string) => d?.slice(0, 10).split("-").reverse().join("/");
export function BankTransitDialog({ hotelId, pending, onClose }: { hotelId: string; pending: BankPending | null; onClose: () => void }) {
  const query = useBankTransit(hotelId, pending);
  const [batch, setBatch] = useState<BatchTarget | null>(null);
  const [boleto, setBoleto] = useState<BoletoTarget | null>(null);
  const data = query.data;
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const confirm = useMutation({ mutationFn: async () => {
    if (!data?.bank) throw new Error("Crédito indisponível");
    const { error } = await supabase.rpc("conc_confirm_transit_candidates", { p_hotel: hotelId, p_bank: data.bank.id, p_opera: selected, p_note: note });
    if (error) throw error;
  }, onSuccess: () => { for (const key of ["bank-transit", "conc-daily-closing", "conc-bank", "conc-opera", "conc-matches", "conc-divergences", "conc-divergence-summary"]) qc.invalidateQueries({ queryKey: [key] }); setSelected([]); setNote(""); toast.success("Crédito conciliado; pendência revertida com histórico."); }, onError: e => toast.error(e.message) });
  const selectedTotal = (data?.candidates ?? []).filter(c => selected.includes(c.id)).reduce((sum, c) => sum + c.amount, 0);
  return <><Dialog open={!!pending} onOpenChange={open => { if (!open) { setSelected([]); setNote(""); onClose(); } }}><DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle className="pr-6 break-words">{pending?.description || "Crédito bancário"}</DialogTitle></DialogHeader>
    {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : query.isError ? <p role="alert" className="text-destructive">{query.error.message}</p> : data && <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center"><Badge variant={pending?.status === "aberta" ? "destructive" : "secondary"}>{pending?.status === "aberta" ? "Pendência aberta" : "Ciclo histórico revertido"}</Badge><span>{day(data.bank?.date ?? "")} · {fmtBRL(data.bank?.amount ?? Math.abs(pending?.valor ?? 0))}</span><span className="text-muted-foreground text-sm">{data.bank?.account || "Conta sem nome"}</span></div>
      <p className="text-sm">{data.reason}</p>
      {data.matches.map(m => <p key={m.id} className="text-sm border-t border-border pt-2">{m.note || m.kind}</p>)}
      {data.opera.length > 0 && <section><h3 className="font-semibold text-sm mb-2">Ópera vinculado ao crédito</h3>{data.opera.map(o => <p key={o.id} className="text-sm">{day(o.business_date)} · {o.guest_full_name} · UH {o.room} · Rec. {o.receipt_no} · {fmtBRL(o.amount)}</p>)}</section>}
      {data.bank && ["rede", "b2b"].includes(data.type) && <Button variant="outline" onClick={() => setBatch({ source: "bank", id: data.bank?.id ?? "", label: data.bank?.description ?? "Composição" })}>Conferir lote e descontos</Button>}
      {data.bank && data.type === "boleto" && <Button variant="outline" onClick={() => setBoleto({ day: data.bank?.date ?? "", amount: data.bank?.amount ?? 0, description: data.bank?.description ?? "Boleto" })}>Conferir liquidações da Francesinha</Button>}
      {["pix", "cash"].includes(data.type) && <section className="space-y-2"><h3 className="text-sm font-semibold">Recebimentos candidatos no Ópera — D−1 a D+1 ({data.candidates.length})</h3><Table><TableHeader><TableRow><TableHead /><TableHead>Data</TableHead><TableHead>Hóspede / UH / Recibo</TableHead><TableHead>Categoria</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader><TableBody>{data.candidates.map(o => <TableRow key={o.id}><TableCell><Checkbox aria-label={`Selecionar recibo ${o.receipt || o.id}`} disabled={!!o.matched_at || !!data.bank?.matched_at || confirm.isPending} checked={selected.includes(o.id)} onCheckedChange={v => setSelected(old => v === true ? [...old, o.id] : old.filter(id => id !== o.id))} /></TableCell><TableCell>{day(o.date)}</TableCell><TableCell>{o.guest} · {o.room} · {o.receipt}</TableCell><TableCell>{o.category}</TableCell><TableCell>{o.matched_at ? "Já conciliado em outro vínculo" : "Sem vínculo confirmado"}</TableCell><TableCell className="text-right">{fmtBRL(o.amount)}</TableCell></TableRow>)}{!data.candidates.length && <TableRow><TableCell colSpan={6}>Nenhum recebimento encontrado no intervalo.</TableCell></TableRow>}</TableBody></Table>
        {!data.bank?.matched_at && pending?.status === "aberta" && <><p className="text-sm">Selecionado: {fmtBRL(selectedTotal)} · Banco: {fmtBRL(data.bank?.amount ?? 0)}</p><Textarea aria-label="Justificativa da conciliação bancária" value={note} onChange={e => setNote(e.target.value)} placeholder="Comprovação do vínculo entre os recebimentos e o crédito" /><Button variant="outline" disabled={!selected.length || note.trim().length < 10 || Math.round(selectedTotal * 100) !== Math.round((data.bank?.amount ?? 0) * 100) || confirm.isPending} onClick={() => confirm.mutate()}>Confirmar conciliação do crédito</Button></>}
      </section>}
    </div>}
  </DialogContent></Dialog><SettlementBatchDialog hotelId={hotelId} target={batch} onClose={() => setBatch(null)} /><BoletoCreditDialog hotelId={hotelId} target={boleto} onClose={() => setBoleto(null)} /></>;
}