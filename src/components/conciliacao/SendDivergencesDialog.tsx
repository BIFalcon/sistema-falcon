import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSendableDivergences, useSendConcDivergences } from "@/hooks/useConcDivergences";
import { divergenceItemKey, selectedDivergenceTotals } from "@/lib/conciliationDivergences";
import { fmtBRL, fmtDate } from "@/lib/formatters";

const kinds: Record<string, string> = { cartao: "Cartão", pix_extrato: "PIX", dinheiro: "Dinheiro", inadimplente: "Faturamento inadimplente" };
const sides: Record<string, string> = { opera: "Opera", acquirer: "Adquirente", bank: "Banco", invoice: "Faturamento" };

export function SendDivergencesDialog({ hotelId, open, onOpenChange }: { hotelId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const query = useSendableDivergences(hotelId, open);
  const send = useSendConcDivergences();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!open) { setInitialized(false); setKeys(new Set()); return; }
    if (query.data && !initialized) { setKeys(new Set(query.data.map(divergenceItemKey))); setInitialized(true); }
  }, [open, query.data, initialized]);
  const items = query.data ?? [];
  const totals = selectedDivergenceTotals(items, keys);
  const all = items.length > 0 && totals.count === items.length;
  return <Dialog open={open} onOpenChange={value => { if (!send.isPending) onOpenChange(value); }}>
    <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
      <DialogHeader><DialogTitle>Selecionar divergências para GG e Administrativo</DialogTitle></DialogHeader>
      {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : query.error ? <p role="alert" className="text-destructive">Não foi possível carregar as divergências.</p> : <>
        <div className="flex flex-wrap justify-between gap-3 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={all ? true : totals.count ? "indeterminate" : false} disabled={send.isPending || !items.length} onCheckedChange={value => setKeys(value ? new Set(items.map(divergenceItemKey)) : new Set())} />Selecionar todas ({items.length})</label>
          <strong>{totals.count} selecionada(s) · {fmtBRL(totals.amount)}</strong>
        </div>
        <div className="overflow-auto min-h-0 flex-1">
          <Table><TableHeader><TableRow><TableHead className="w-10" /><TableHead>Tipo / Origem</TableHead><TableHead>Data</TableHead><TableHead>Lançamento</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>{items.map(item => { const key = divergenceItemKey(item); return <TableRow key={key}>
              <TableCell><Checkbox aria-label={`Selecionar ${item.title} ${item.id}`} checked={keys.has(key)} disabled={send.isPending} onCheckedChange={value => setKeys(previous => { const next = new Set(previous); if (value) next.add(key); else next.delete(key); return next; })} /></TableCell>
              <TableCell className="text-xs">{kinds[item.kind]}<div className="text-muted-foreground">{sides[item.side]}</div></TableCell>
              <TableCell className="text-xs whitespace-nowrap">{fmtDate(item.date)}</TableCell>
              <TableCell className="text-xs break-words">{item.title}<div className="text-muted-foreground">{item.subtitle}{item.tag ? ` · ${item.tag}` : ""}</div></TableCell>
              <TableCell className="text-xs text-right whitespace-nowrap">{fmtBRL(item.amount)}</TableCell>
            </TableRow>; })}{!items.length && <TableRow><TableCell colSpan={5}>Nenhuma divergência ou inadimplência neste hotel.</TableCell></TableRow>}</TableBody>
          </Table>
        </div>
      </>}
      <DialogFooter><Button variant="outline" disabled={send.isPending} onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={send.isPending || query.isFetching || !!query.error || !totals.count} onClick={() => send.mutate({ hotelId, keys: items.filter(item => keys.has(divergenceItemKey(item))).map(divergenceItemKey) }, {
        onSuccess: result => { toast.info(result.already_pending ? "Já existe um envio aguardando processamento." : result.empty ? "Nenhuma pendência selecionada continua em aberto." : result.queued ? `${result.queued} e-mail(s) enfileirado(s) para GG/ADM.` : "Nenhum destinatário GG/ADM ativo disponível."); onOpenChange(false); },
        onError: (error: Error) => { toast.error(error.message); query.refetch(); },
      })}>{send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Enviar selecionadas</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}