import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL } from "@/lib/formatters";
import { batchProgress } from "@/lib/settlementBatch";
import { useSettlementBatch, type BatchTarget } from "@/hooks/useSettlementBatch";

const day = (d: string | null) => d ? d.split("-").reverse().join("/") : "—";
const money = (n: number | null) => n === null ? "Sem dado" : fmtBRL(n);
export function SettlementBatchDialog({ hotelId, target, onClose }: { hotelId: string; target: BatchTarget | null; onClose: () => void }) {
  const query = useSettlementBatch(hotelId, target);
  const [onlyPending, setOnlyPending] = useState(false);
  return <Dialog open={!!target} onOpenChange={open => { if (!open) { onClose(); setOnlyPending(false); } }}>
    <DialogContent className="max-w-6xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle className="break-words pr-6">{target?.label ?? "Composição do lote"}</DialogTitle></DialogHeader>
      <div className="flex justify-between items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyPending} onCheckedChange={v => setOnlyPending(v === true)} />Somente não conciliados</label>
        <Button size="icon" variant="outline" aria-label="Atualizar composição do lote" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : query.isError ? <p role="alert" className="text-destructive">Não foi possível conferir o lote: {query.error.message}</p> : <>
        {query.data?.transition && <Badge variant="outline">Baixa de transição — não representa conciliação de vendas</Badge>}
        {query.data?.ambiguous && <p role="alert" className="text-destructive text-sm">Há mais de um lote candidato para este crédito. O vínculo não está comprovado e a baixa permanece bloqueada.</p>}
        {!query.data?.batches.length && <p className="text-sm text-muted-foreground">Não foi encontrado relatório correspondente a este crédito. Sem composição comprovada, a baixa normal fica bloqueada.</p>}
        {query.data?.batches.map(batch => <section key={batch.id} className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div><h3 className="font-semibold">{day(batch.date)} · {batch.label}</h3><p className="text-sm">Lote {money(batch.amount)} · Parcelas líquidas {money(batch.net)}</p></div>
            <Badge variant={batch.ready && !query.data?.ambiguous ? "secondary" : "destructive"}>{batch.reconciled}/{batch.total} vendas · {batchProgress(batch)}% conciliado</Badge>
          </div>
          <p className={batch.ready ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{batch.reason}</p>
          <Table><TableHeader><TableRow><TableHead>Venda / NSU</TableHead><TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Líquido</TableHead><TableHead>Conciliação</TableHead><TableHead>Ópera — data, hóspede, UH, recibo e valor</TableHead></TableRow></TableHeader>
            <TableBody>{batch.sales.filter(s => !onlyPending || s.status !== "Conciliado").map(s => <TableRow key={s.payment_id} className={s.status !== "Conciliado" ? "bg-destructive/5" : ""}>
              <TableCell className="text-xs whitespace-nowrap">{day(s.sale_date)}<br /><span className="font-mono">{s.nsu ?? "Sem NSU"}</span></TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap">{money(s.gross)}</TableCell><TableCell className="text-right text-xs whitespace-nowrap">{money(s.net)}</TableCell>
              <TableCell><Badge variant={s.status === "Conciliado" ? "secondary" : "destructive"}>{s.status}</Badge></TableCell>
              <TableCell className="text-xs min-w-[240px]">{s.opera.length ? s.opera.map(o => <div key={o.id} className="py-1">{day(o.date)} · {o.guest ?? "—"} · UH {o.room ?? "—"} · Rec. #{o.receipt ?? "—"}<br />{o.category ?? "—"} · {money(o.amount)}</div>) : <span className="text-destructive">Sem par conciliado no Ópera ({day(s.sale_date)})</span>}</TableCell>
            </TableRow>)}{!batch.sales.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">Sem vendas identificadas.</TableCell></TableRow>}</TableBody>
          </Table>
        </section>)}
      </>}
    </DialogContent>
  </Dialog>;
}