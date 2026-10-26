import { useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Loader2, RefreshCw, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReconcilePanel, Money, type BoxConfig, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import { useB2BAutoMatch, useB2BBaixaData, useB2BUnmatchDeposit, useImportB2BReceipts } from "@/hooks/useB2BBaixa";
import { B2B_BANK_PREFIX } from "@/lib/b2bBaixa";
import { SettlementCutoffPanel } from "@/components/conciliacao/SettlementCutoffPanel";
import { useSettlementCutoff } from "@/hooks/useSettlementCutoff";
import { excludedSettlementIds, isSaleInScope } from "@/lib/settlementCutoff";

const day = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export function B2BBaixaTab({ hotelId }: { hotelId: string }) {
  const { data, isLoading } = useB2BBaixaData(hotelId);
  const auto = useB2BAutoMatch();
  const unmatch = useB2BUnmatchDeposit();
  const cutoff = useSettlementCutoff(hotelId, "b2b");
  const excluded = excludedSettlementIds(cutoff.data?.items ?? [], cutoff.data?.cutoff);
  const receipts = (data?.receipts ?? []).filter((r) => !excluded.has(`b2b:${r.id}`));
  const charges = receipts.filter((r) => r.tipo_lancamento === "charge");
  const deposits = receipts.filter((r) => r.tipo_lancamento === "deposit");
  const linkedSaleIds = new Set(charges.map((c) => c.matched_acquirer_id).filter(Boolean) as string[]);

  const boxes: BoxConfig[] = useMemo(() => [
    {
      key: "vendas", title: "B2B Vendas", subtitle: "Já conciliadas com o Opera, ainda sem recebimento", position: "left",
      rows: (data?.sales ?? []).filter((s) => !linkedSaleIds.has(s.id) && isSaleInScope(s.sale_date, cutoff.data?.cutoff)).map<ReconcileRow>((s) => ({
        id: s.id, side: "acquirer", date: s.sale_date, amount: Number(s.amount),
        title: s.bandeira ?? "B2B", subtitle: s.codigo_reserva ? `Reserva ${s.codigo_reserva}` : "Sem código de reserva", origin: "B2B",
      })),
    },
    {
      key: "receb", title: "B2B Recebimentos", subtitle: "Lançamentos charge pendentes de baixa", position: "left",
      rows: charges.filter((c) => !c.matched_at).map<ReconcileRow>((c) => ({
        id: c.id, side: "acquirer", date: c.data_operacao, amount: Number(c.valor_recebivel_liquido ?? 0),
        title: c.bandeira ?? c.descricao ?? "Recebimento",
        subtitle: `${c.localizador_reserva ? `Reserva ${c.localizador_reserva}` : "Sem reserva"} · ${c.matched_acquirer_id ? "ligado à venda" : "sem venda"}`,
        tag: c.matched_acquirer_id ? "Venda ok" : undefined,
      })),
    },
    {
      key: "banco", title: `Banco (${B2B_BANK_PREFIX}…)`, subtitle: "Créditos pendentes no extrato", position: "right",
      rows: (data?.bank ?? []).filter((b) => !b.matched_at && !excluded.has(`bank:${b.id}`)).map<ReconcileRow>((b) => ({
        id: b.id, side: "bank", date: b.line_date, amount: Number(b.amount), title: b.description ?? "",
      })),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [data, cutoff.data]);

  const bankById = new Map((data?.bank ?? []).map((b) => [b.id, b]));
  const chargesByDeposit = new Map<string, number>();
  for (const c of charges) if (c.deposit_id) chargesByDeposit.set(c.deposit_id, (chargesByDeposit.get(c.deposit_id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <SettlementCutoffPanel key={hotelId} hotelId={hotelId} provider="b2b" />
      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-center">
        <Button variant="outline" size="sm" disabled={auto.isPending}
          onClick={() => auto.mutate(hotelId, {
            onSuccess: (r) => toast.success(`${r.sales_linked} venda(s) ligada(s), ${r.deposits_matched} lote(s) baixado(s).`),
            onError: (e) => toast.error((e as Error).message),
          })}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Baixa automática
        </Button>
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : (
        <ReconcilePanel
          boxes={boxes}
          onReconcile={() => toast.info("A baixa B2B é feita pela baixa automática (reserva e valor do lote).")}
          isReconciling={false}
          exportName={`baixa-b2b-${hotelId}.xlsx`}
        />
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Lotes de depósito B2B</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data operação</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Recebimentos</TableHead>
                <TableHead className="text-right">Valor líquido</TableHead><TableHead>Banco</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">Nenhum lote importado.</TableCell></TableRow>
              ) : deposits.map((d) => {
                const b = d.matched_bank_id ? bankById.get(d.matched_bank_id) : null;
                return (
                  <TableRow key={d.id} className="text-xs">
                    <TableCell>{day(d.data_operacao)}</TableCell>
                    <TableCell>{d.descricao ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{chargesByDeposit.get(d.id) ?? 0}</TableCell>
                    <TableCell className="text-right"><Money value={Number(d.valor_recebivel_liquido ?? 0)} /></TableCell>
                    <TableCell>
                      {d.matched_bank_id
                        ? <Badge variant="secondary">Baixado {b ? `· ${day(b.line_date)} · ${b.description ?? ""}` : ""}</Badge>
                        : <Badge variant="outline">Pendente</Badge>}
                    </TableCell>
                    <TableCell>
                      {d.matched_bank_id && (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={unmatch.isPending} onClick={() => unmatch.mutate(d.id)}>
                          <Undo2 className="h-3 w-3 mr-1" /> Desfazer
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function B2BReceiptsImporter({ hotelId }: { hotelId: string }) {
  const importer = useImportB2BReceipts();

  const { getRootProps, getInputProps } = useDropzone({
    maxFiles: 1, disabled: importer.isPending,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] },
    onDrop: (files) => files[0] && importer.mutate({ file: files[0], hotelId }, {
      onSuccess: (r) => toast.success(`${r.inserted} recebimento(s) importado(s)${r.duplicates ? `, ${r.duplicates} já existiam` : ""}. ${r.sales_linked} venda(s) ligada(s) pela reserva, ${r.deposits_matched} lote(s) baixado(s) no banco.`),
      onError: (e) => toast.error((e as Error).message),
    }),
  });

return (        <div {...getRootProps()} className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-accent/50">
          <input {...getInputProps()} />
          <div className="flex items-center justify-center gap-2 text-sm">
            {importer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 opacity-50" />}
            Importar “Transferência B2B Checkout” (aba transfer)
          </div>
        </div>
);
}
