import { Fragment, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/conciliacao/ReconcilePanel";
import { useImportRedeRecebimentos, useRedeAutoMatch, useRedeRecebimentosData, useRedeUnmatch } from "@/hooks/useRedeRecebimentos";
import { buildTarifas, isAntecipacao, REDE_BANK_PREFIX } from "@/lib/redeRecebimentos";
import { SettlementCutoffPanel } from "@/components/conciliacao/SettlementCutoffPanel";
import { useSettlementCutoff } from "@/hooks/useSettlementCutoff";
import { excludedSettlementIds } from "@/lib/settlementCutoff";
import { SettlementBatchDialog } from "@/components/conciliacao/SettlementBatchDialog";
import type { BatchTarget } from "@/hooks/useSettlementBatch";

const day = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${m}/${y}`; };

export function RedeReceiptsImporter({ hotelId }: { hotelId: string }) {
  const importer = useImportRedeRecebimentos();
  const { getRootProps, getInputProps } = useDropzone({
    maxFiles: 1, disabled: importer.isPending,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (files) => files[0] && importer.mutate({ file: files[0], hotelId }, {
      onSuccess: (r) => toast.success(`Recebimentos Rede: ${r.pagamentos} pagamento(s), ${r.recebidos} recebido(s), ${r.ajustes} ajuste(s), ${r.chargebacks} cancelamento(s)/chargeback(s) novos. ${r.matched} baixa(s) no banco.`),
      onError: (e) => toast.error((e as Error).message),
    }),
  });
  return (
    <div {...getRootProps()} className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-accent/50">
      <input {...getInputProps()} />
      {importer.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : <Upload className="h-4 w-4 mx-auto text-muted-foreground" />}
      <p className="text-xs text-muted-foreground mt-1">Relatório de recebimentos da Rede (.xlsx, todas as abas)</p>
    </div>
  );
}

export function RedeBaixaTab({ hotelId }: { hotelId: string }) {
  const [batchTarget, setBatchTarget] = useState<BatchTarget | null>(null);
  const { data, isLoading } = useRedeRecebimentosData(hotelId);
  const auto = useRedeAutoMatch();
  const unmatch = useRedeUnmatch();
  const cutoff = useSettlementCutoff(hotelId, "rede");
  const excluded = excludedSettlementIds(cutoff.data?.items ?? [], cutoff.data?.cutoff);
  const bankById = new Map((data?.bank ?? []).map((b) => [b.id, b]));
  const recebidos = (data?.recebidos ?? []).filter((r) => Number(r.valor_depositado ?? 0) > 0);
  const pend = recebidos.filter((r) => !r.matched_bank_id && !excluded.has(`rede:${r.id}`));
  const done = recebidos.filter((r) => r.matched_bank_id);
  const bankPend = (data?.bank ?? []).filter((b) => !b.matched_at && b.amount > 0);

  return (
    <div className="space-y-4">
      <SettlementBatchDialog hotelId={hotelId} target={batchTarget} onClose={() => setBatchTarget(null)} />
      <SettlementCutoffPanel key={hotelId} hotelId={hotelId} provider="rede" />
      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-center">
        <Button size="sm" variant="outline" disabled={auto.isPending} onClick={() => auto.mutate(hotelId, {
          onSuccess: (r) => toast.success(`${r.matched} recebimento(s) baixado(s) no banco.`),
          onError: (e) => toast.error((e as Error).message),
        })}>
          {auto.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />} Baixar automaticamente
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Compara o recebido da Rede (já somado por dia + bandeira + modalidade) com créditos do extrato "{REDE_BANK_PREFIX} &lt;bandeira&gt; CD/DB/AT…", mesmo valor, de 1 dia antes até 3 dias depois.
      </p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recebidos Rede pendentes ({pend.length})</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-[420px] overflow-y-auto">
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Bandeira</TableHead><TableHead>Modalidade</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>{pend.map((r) => (
                  <TableRow key={r.id}><TableCell className="text-xs">{day(r.data)}</TableCell><TableCell className="text-xs"><Button variant="link" className="h-auto p-0 text-xs" onClick={() => setBatchTarget({ source: "rede", id: r.id, label: `${day(r.data)} · ${r.bandeira} ${r.modalidade}` })}>{r.bandeira}</Button></TableCell><TableCell className="text-xs">{r.modalidade}</TableCell><TableCell className="text-right text-xs"><Money value={Number(r.valor_depositado)} /></TableCell></TableRow>
                ))}</TableBody></Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Banco ({REDE_BANK_PREFIX}) pendente ({bankPend.length})</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-[420px] overflow-y-auto">
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>{bankPend.map((b) => (
                  <TableRow key={b.id}><TableCell className="text-xs">{day(b.line_date)}</TableCell><TableCell className="text-xs"><Button variant="link" className="h-auto p-0 text-xs text-left whitespace-normal" onClick={() => setBatchTarget({ source: "bank", id: b.id, label: b.description ?? "Crédito bancário" })}>{b.description}</Button></TableCell><TableCell className="text-right text-xs"><Money value={b.amount} /></TableCell></TableRow>
                ))}</TableBody></Table>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Baixados ({done.length})</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-[420px] overflow-y-auto">
              <Table><TableHeader><TableRow><TableHead>Data Rede</TableHead><TableHead>Bandeira / modalidade</TableHead><TableHead>Banco</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{done.map((r) => {
                  const b = r.matched_bank_id ? bankById.get(r.matched_bank_id) : undefined;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{day(r.data)}</TableCell>
                      <TableCell className="text-xs">{r.bandeira} · {r.modalidade}</TableCell>
                      <TableCell className="text-xs"><Button variant="link" className="h-auto p-0 text-xs text-left whitespace-normal" onClick={() => setBatchTarget({ source: "rede", id: r.id, label: b?.description ?? `${r.bandeira} · ${r.modalidade}` })}>{b ? `${day(b.line_date)} · ${b.description}` : "Ver lote"}</Button></TableCell>
                      <TableCell className="text-right text-xs"><Money value={Number(r.valor_depositado)} /></TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={unmatch.isPending} onClick={() => unmatch.mutate(r.id)}><Undo2 className="h-3 w-3 mr-1" />Desfazer</Button></TableCell>
                    </TableRow>
                  );
                })}</TableBody></Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export function RedeChargebacksTab({ hotelId }: { hotelId: string }) {
  const { data, isLoading } = useRedeRecebimentosData(hotelId);
  const salesByNsu = new Map((data?.sales ?? []).map((s) => [String(s.nsu), s]));
  const rows = data?.chargebacks ?? [];
  const total = rows.reduce((s, r) => s + Number(r.valor_descontado ?? 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">Fonte: aba "cancelamentos e contestações" do relatório de recebimentos. Não entram na fila normal de baixa.</p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cancelamentos e chargebacks ({rows.length}) · <Money value={-Math.abs(total)} /></CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>Débito</TableHead><TableHead>Tipo</TableHead><TableHead>Venda original</TableHead><TableHead>NSU/CV</TableHead><TableHead>Bandeira</TableHead><TableHead>Motivo</TableHead><TableHead className="text-right">Valor venda</TableHead><TableHead className="text-right">Descontado</TableHead><TableHead>Venda no sistema</TableHead></TableRow></TableHeader>
              <TableBody>{rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground">Nenhum registro.</TableCell></TableRow>
              ) : rows.map((r) => {
                const s = r.nsu_cv ? salesByNsu.get(r.nsu_cv) : undefined;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{day(r.data_debito)}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.tipo ?? "—"}</Badge></TableCell>
                    <TableCell className="text-xs">{day(r.data_original_venda)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.nsu_cv ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.bandeira} {r.modalidade ? `· ${r.modalidade}` : ""}</TableCell>
                    <TableCell className="text-xs">{r.motivo_cancelamento ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs"><Money value={Number(r.valor_original_venda ?? 0)} /></TableCell>
                    <TableCell className="text-right text-xs"><Money value={-Math.abs(Number(r.valor_descontado ?? 0))} /></TableCell>
                    <TableCell className="text-xs">{s ? <Badge variant="secondary" className="text-[10px]">{day(s.sale_date)} · encontrada</Badge> : <span className="text-muted-foreground">não encontrada</span>}</TableCell>
                  </TableRow>
                );
              })}</TableBody></Table>
          </CardContent></Card>
      )}
    </div>
  );
}

export function RedeAntecipacaoTab({ hotelId }: { hotelId: string }) {
  const { data, isLoading } = useRedeRecebimentosData(hotelId);
  const rows = (data?.ajustes ?? []).filter((a) => isAntecipacao(a.motivo));
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.valor_cobrado ?? 0)), 0);
  return (
    <div className="space-y-3">
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Taxas de antecipação ({rows.length}) · <Money value={-total} /></CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[520px] overflow-y-auto">
            <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Bandeira</TableHead><TableHead>Motivo</TableHead><TableHead className="text-right">Valor cobrado</TableHead></TableRow></TableHeader>
              <TableBody>{rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground">Nenhum registro.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}><TableCell className="text-xs">{day(r.data_ajuste)}</TableCell><TableCell className="text-xs">{r.bandeira ?? "—"}</TableCell><TableCell className="text-xs">{r.motivo}</TableCell><TableCell className="text-right text-xs"><Money value={-Math.abs(Number(r.valor_cobrado ?? 0))} /></TableCell></TableRow>
              ))}</TableBody></Table>
          </CardContent></Card>
      )}
    </div>
  );
}

export function TarifasTab({ hotelId }: { hotelId: string }) {
  const { data, isLoading } = useRedeRecebimentosData(hotelId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const months = useMemo(() => {
    const days = buildTarifas(data?.pagamentos ?? [], data?.b2b ?? [], data?.ajustes ?? []);
    const m = new Map<string, { ym: string; rede_mdr: number; b2b: number; ajustes: number; total: number; days: typeof days }>();
    for (const d of days) {
      const ym = d.date.slice(0, 7);
      const r = m.get(ym) ?? { ym, rede_mdr: 0, b2b: 0, ajustes: 0, total: 0, days: [] };
      r.rede_mdr += d.rede_mdr; r.b2b += d.b2b; r.ajustes += d.ajustes; r.total += d.total; r.days.push(d);
      m.set(ym, r);
    }
    return [...m.values()].sort((a, b) => b.ym.localeCompare(a.ym));
  }, [data]);
  const toggle = (ym: string) => setOpen((p) => { const n = new Set(p); n.has(ym) ? n.delete(ym) : n.add(ym); return n; });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">MDR descontado da Rede (aba pagamentos) + taxa de adquirência B2B + demais ajustes da Rede (exceto taxa de antecipação). Clique no mês para ver os dias.</p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>Período</TableHead><TableHead className="text-right">MDR Rede</TableHead><TableHead className="text-right">Taxa B2B</TableHead><TableHead className="text-right">Outros ajustes Rede</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>{months.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground">Nenhuma tarifa importada.</TableCell></TableRow>
            ) : months.map((m) => (
              <Fragment key={m.ym}>
                <TableRow className="cursor-pointer font-medium" onClick={() => toggle(m.ym)}>
                  <TableCell className="text-xs">{open.has(m.ym) ? <ChevronDown className="inline h-3 w-3 mr-1" /> : <ChevronRight className="inline h-3 w-3 mr-1" />}{monthLabel(m.ym)}</TableCell>
                  <TableCell className="text-right text-xs"><Money value={-m.rede_mdr} /></TableCell>
                  <TableCell className="text-right text-xs"><Money value={-m.b2b} /></TableCell>
                  <TableCell className="text-right text-xs"><Money value={-m.ajustes} /></TableCell>
                  <TableCell className="text-right text-xs"><Money value={-m.total} /></TableCell>
                </TableRow>
                {open.has(m.ym) && m.days.map((d) => (
                  <TableRow key={d.date} className="bg-muted/30">
                    <TableCell className="text-xs pl-8">{day(d.date)}</TableCell>
                    <TableCell className="text-right text-xs"><Money value={-d.rede_mdr} /></TableCell>
                    <TableCell className="text-right text-xs"><Money value={-d.b2b} /></TableCell>
                    <TableCell className="text-right text-xs"><Money value={-d.ajustes} /></TableCell>
                    <TableCell className="text-right text-xs"><Money value={-d.total} /></TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}</TableBody></Table>
        </CardContent></Card>
      )}
    </div>
  );
}
