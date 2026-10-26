import { useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";
import { fmtDay } from "@/components/conciliacao/ReconcilePanel";
import { useDailyBankClosing, useSaveDailyBalance } from "@/hooks/useDailyBankClosing";
import type { DailyClosingRow } from "@/lib/dailyBankClosing";
import { SettlementBatchDialog } from "@/components/conciliacao/SettlementBatchDialog";
import type { BatchTarget } from "@/hooks/useSettlementBatch";
import { BoletoCreditDialog, type BoletoTarget } from "@/components/conciliacao/BoletoCreditDialog";

const money = (n: number | null) => n === null ? "Sem dado" : fmtBRL(n);
export function DailyBankClosingTab({ hotelId, dateFrom, dateTo, dates }: {
  hotelId: string; dateFrom: string; dateTo: string; dates: string[];
}) {
  const query = useDailyBankClosing(hotelId, dateFrom, dateTo, dates);
  const save = useSaveDailyBalance();
  const [editing, setEditing] = useState<DailyClosingRow | null>(null);
  const [initial, setInitial] = useState("");
  const [real, setReal] = useState("");
  const [day, setDay] = useState("");
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const [batchTarget, setBatchTarget] = useState<BatchTarget | null>(null);
  const [boleto, setBoleto] = useState<BoletoTarget | null>(null);
  const pending = (query.data?.pending ?? []).filter(p => !pendingDay || p.day === pendingDay);
  const openEdit = (row?: DailyClosingRow) => {
    const value = row ?? { day: dateFrom || new Date().toISOString().slice(0, 10), initial: null, real: null, credits: 0, received: 0, paid: 0, pending: 0, final: null, difference: null };
    setEditing(value); setDay(value.day); setInitial(value.initial === null ? "" : String(value.initial)); setReal(value.real === null ? "" : String(value.real));
  };
  return <section className="space-y-5">
    <SettlementBatchDialog hotelId={hotelId} target={batchTarget} onClose={() => setBatchTarget(null)} />
    <BoletoCreditDialog hotelId={hotelId} target={boleto} onClose={() => setBoleto(null)} />
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="font-semibold">Fechamento diário</h2>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => openEdit()}><Pencil className="mr-2 h-4 w-4" /> Informar saldos</Button>
        <Button variant="outline" size="icon" aria-label="Atualizar fechamento" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {query.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar o fechamento: {query.error.message}</p> : query.isLoading ? <p className="text-sm text-muted-foreground">Carregando fechamento…</p> : <Table>
      <TableHeader><TableRow>
        {["Dia", "Saldo inicial", "Créditos do banco", "Recebido conciliado", "Pago", "Pendências abertas", "Saldo final", "Saldo real", "Diferença", ""].map((h, i) => <TableHead key={i} className={i ? "text-right text-xs whitespace-normal" : "text-xs"}>{h}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>
        {!query.data?.days.length && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Nenhum extrato ou saldo no período.</TableCell></TableRow>}
        {(query.data?.days ?? []).map(row => <TableRow key={row.day}>
          <TableCell className="text-xs whitespace-nowrap">{fmtDay(row.day)}</TableCell>
          {[row.initial, row.credits, row.received, row.paid].map((v, i) => <TableCell key={i} className="text-right text-xs tabular-nums whitespace-nowrap">{money(v)}</TableCell>)}
          <TableCell className="text-right"><Button variant="ghost" size="sm" className="text-xs tabular-nums" onClick={() => setPendingDay(row.day)}>{money(row.pending)}</Button></TableCell>
          <TableCell className="text-right text-xs font-semibold whitespace-nowrap">{money(row.final)}</TableCell>
          <TableCell className="text-right text-xs whitespace-nowrap">{money(row.real)}</TableCell>
          <TableCell className="text-right text-xs whitespace-nowrap"><Badge variant={row.difference !== null && Math.abs(row.difference) >= 0.01 ? "destructive" : "secondary"}>{money(row.difference)}</Badge></TableCell>
          <TableCell><Button variant="ghost" size="icon" aria-label={`Informar saldos de ${fmtDay(row.day)}`} onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>}
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Conta transitória {pendingDay ? `— ${fmtDay(pendingDay)}` : ""}</h3>{pendingDay && <Button variant="ghost" size="sm" onClick={() => setPendingDay(null)}>Todos os dias</Button>}</div>
    <Table><TableHeader><TableRow><TableHead>Dia</TableHead><TableHead>Lançamento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Status</TableHead><TableHead>Aberta em</TableHead><TableHead>Revertida em</TableHead><TableHead>Conciliação</TableHead></TableRow></TableHeader>
      <TableBody>{!pending.length && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Nenhuma pendência no período.</TableCell></TableRow>}{pending.map(p => <TableRow key={p.id}>
        <TableCell className="text-xs whitespace-nowrap">{fmtDay(p.day)}</TableCell><TableCell className="text-xs max-w-xs break-words">{/^(RECEBIMENTO REDE|ZOOP)/i.test(p.description?.trim() ?? "") ? <Button variant="link" className="h-auto p-0 text-xs whitespace-normal text-left" onClick={() => setBatchTarget({ source: "bank", id: p.entry_id, label: p.description ?? "Crédito bancário" })}>{p.description}</Button> : /BOLETO|COBRANCA|COBRANÇA|LIQUIDACAO|LIQUIDAÇÃO/i.test(p.description ?? "") ? <Button variant="link" className="h-auto p-0 text-xs whitespace-normal text-left" onClick={() => setBoleto({ day: p.day, amount: Number(p.valor), description: p.description ?? "Boleto" })}>{p.description}</Button> : p.description || "—"}</TableCell><TableCell className="text-right text-xs whitespace-nowrap">{fmtBRL(p.valor)}</TableCell><TableCell><Badge variant={p.status === "aberta" ? "destructive" : "secondary"}>{p.status === "aberta" ? "Aberta" : "Revertida"}</Badge></TableCell><TableCell className="text-xs">{fmtDateTime(p.aberta_em)}</TableCell><TableCell className="text-xs">{p.revertida_em ? fmtDateTime(p.revertida_em) : "—"}</TableCell><TableCell className="text-xs font-mono" title={p.match_id ?? undefined}>{p.match_id?.slice(0, 8) ?? "—"}</TableCell>
      </TableRow>)}</TableBody></Table>
    <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Informar saldos</DialogTitle></DialogHeader>
      <div className="space-y-4"><div><Label htmlFor="closing-day">Dia</Label><Input id="closing-day" type="date" value={day} onChange={e => setDay(e.target.value)} /></div><div><Label htmlFor="initial-balance">Saldo inicial (R$)</Label><Input id="initial-balance" type="number" step="0.01" value={initial} onChange={e => setInitial(e.target.value)} /></div><div><Label htmlFor="real-balance">Saldo real do extrato (R$)</Label><Input id="real-balance" type="number" step="0.01" value={real} onChange={e => setReal(e.target.value)} /></div></div>
      <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={save.isPending || !day || (!initial && !real)} onClick={() => save.mutate({ hotelId, day, initial: initial === "" ? null : Number(initial), real: real === "" ? null : Number(real) }, { onSuccess: () => { setEditing(null); toast.success("Saldos salvos"); }, onError: e => toast.error(e.message) })}>Salvar</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}