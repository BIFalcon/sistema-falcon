import { useEffect, useState } from "react";
import { Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrDateInput } from "@/components/ui/br-date-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/conciliacao/ReconcilePanel";
import { useSettlementCutoff } from "@/hooks/useSettlementCutoff";
import { canTransition, type SettlementProvider } from "@/lib/settlementCutoff";

const day = (value: string | null) => value ? value.slice(0, 10).split("-").reverse().join("/") : "—";
export function SettlementCutoffPanel({ hotelId, provider }: { hotelId: string; provider: SettlementProvider }) {
  const { data, isLoading, error, save, transition, undo } = useSettlementCutoff(hotelId, provider);
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setDate(data?.cutoff ?? ""); setSelected(new Set()); }, [data?.cutoff, hotelId, provider]);
  const candidates = (data?.items ?? []).filter((item) => canTransition(item, data?.cutoff));
  const chosen = candidates.filter((item) => selected.has(`${item.source}:${item.entry_id}`));
  const history = data?.history ?? [];
  return <section className="space-y-3 border-b border-border pb-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs font-medium">Data de corte — {provider === "rede" ? "Rede" : "B2B"}
        <BrDateInput aria-label={`Data de corte ${provider}`} value={date} onChange={setDate} className="h-9 w-40" disabled={isLoading || !!error} />
      </label>
      <Button size="sm" variant="outline" disabled={!date || date === data?.cutoff || save.isPending || !!error} onClick={() => save.mutate(date, { onSuccess: () => toast.success("Data de corte salva para este hotel."), onError: (e) => toast.error(e.message) })}><Save className="mr-1 h-4 w-4" />Salvar corte</Button>
      <Button size="sm" variant="outline" disabled={!data?.cutoff} onClick={() => { setSelected(new Set()); setNote(""); setConfirmed(false); setOpen(true); }}>Baixa de transição ({candidates.length})</Button>
    </div>
    {error && <p className="text-sm text-destructive">Não foi possível carregar a data de corte: {error.message}</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Baixa de transição — {provider.toUpperCase()}</DialogTitle><DialogDescription>Corte: {day(data?.cutoff ?? null)}. Recebimentos de vendas anteriores ou sem origem comprovada. Não serão registrados como conciliação com venda.</DialogDescription></DialogHeader>
        <div className="max-h-72 overflow-auto"><Table><TableHeader><TableRow><TableHead /><TableHead>Origem / recebimento</TableHead><TableHead>Venda original</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader><TableBody>
          {candidates.map((item) => { const key = `${item.source}:${item.entry_id}`; return <TableRow key={key}>
            <TableCell><Checkbox aria-label={`Selecionar ${item.label ?? item.source} ${day(item.item_date)}`} checked={selected.has(key)} onCheckedChange={(checked) => setSelected((old) => { const next = new Set(old); if (checked) next.add(key); else next.delete(key); return next; })} /></TableCell>
            <TableCell className="text-xs">{item.source === "bank" ? "Banco" : item.source.toUpperCase()} · {day(item.item_date)}</TableCell><TableCell className="text-xs">{day(item.original_date)}{item.eligibility === "sem_origem" && <span className="block text-muted-foreground">Origem não comprovada</span>}</TableCell><TableCell className="text-xs">{item.label}</TableCell><TableCell className="text-right text-xs"><Money value={Number(item.amount)} /></TableCell>
          </TableRow>; })}
          {!candidates.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum item disponível para transição.</TableCell></TableRow>}
        </TableBody></Table></div>
        <p className="text-sm">{chosen.length} registro(s) selecionado(s) · <Money value={chosen.reduce((sum, item) => sum + Number(item.amount), 0)} /></p>
        <Textarea aria-label="Justificativa da transição" placeholder="Justificativa da baixa de transição" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><span>Confirmo que os itens selecionados se referem a vendas anteriores ao início deste hotel, inclusive os sem origem comprovada.</span></label>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={!chosen.length || !confirmed || note.trim().length < 10 || transition.isPending} onClick={() => transition.mutate({ items: chosen, note }, { onSuccess: (count) => { toast.success(`${count} baixa(s) de transição registrada(s).`); setOpen(false); }, onError: (e) => toast.error(e.message) })}>Confirmar transição</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {history.length > 0 && <details><summary className="cursor-pointer text-xs font-medium">Histórico de transição ({history.length})</summary><div className="max-h-64 overflow-auto mt-2"><Table><TableHeader><TableRow><TableHead>Registro</TableHead><TableHead>Corte</TableHead><TableHead>Justificativa</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader><TableBody>{history.map((row) => <TableRow key={row.id}><TableCell className="text-xs">{day(row.created_at)} · {row.source}{row.undone_at && <span className="block text-muted-foreground">Desfeita em {day(row.undone_at)}</span>}</TableCell><TableCell className="text-xs">{day(row.cutoff_date)}</TableCell><TableCell className="text-xs">{row.note}</TableCell><TableCell className="text-right text-xs"><Money value={Number(row.amount)} /></TableCell><TableCell>{!row.undone_at && <Button variant="ghost" size="sm" disabled={undo.isPending} onClick={() => undo.mutate(row.id, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success("Baixa de transição desfeita.") })}><Undo2 className="h-3 w-3 mr-1" />Desfazer</Button>}</TableCell></TableRow>)}</TableBody></Table></div></details>}
  </section>;
}