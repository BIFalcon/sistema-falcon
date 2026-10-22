import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/conciliacao/ReconcilePanel";
import { useBillingDue, useFrancesinhaEntries, useImportFrancesinha } from "@/hooks/useFrancesinha";

const day = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const RESULT: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  baixa_dada: { label: "Pago — baixa dada", variant: "default" },
  liquidado_sem_faturamento: { label: "Liquidado — faturamento não encontrado", variant: "outline" },
  pendencia: { label: "Pendência — boleto novo", variant: "destructive" },
  baixa_apos_liquidacao: { label: "Baixa após liquidação", variant: "secondary" },
  informativo: { label: "Entrada na carteira", variant: "secondary" },
  ajuste: { label: "Ajuste / custo", variant: "outline" },
  sem_acao: { label: "Sem ação", variant: "outline" },
};

export function FrancesinhaTab({ hotelId }: { hotelId: string }) {
  const { data, isLoading } = useFrancesinhaEntries(hotelId);
  const importer = useImportFrancesinha();
  const { getRootProps, getInputProps } = useDropzone({
    maxFiles: 1, disabled: importer.isPending,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (f) => f[0] && importer.mutate({ file: f[0], hotelId }, {
      onSuccess: (r) => toast.success(`${r.inserted} linha(s) nova(s)${r.duplicates ? `, ${r.duplicates} já existiam` : ""}. ${r.paid} baixa(s) de faturamento, ${r.pending} pendência(s) de boleto novo, ${r.adjustments} ajuste(s).`),
      onError: (e) => toast.error((e as Error).message),
    }),
  });
  const rows = data ?? [];
  return (
    <div className="space-y-3">
      <div {...getRootProps()} className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-accent/50">
        <input {...getInputProps()} />
        {importer.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : <Upload className="h-4 w-4 mx-auto text-muted-foreground" />}
        <p className="text-xs text-muted-foreground mt-1">Francesinha (extrato de boletos, uma aba por dia)</p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Liquidação dá baixa no faturamento (seu número = nº do boleto/nota, mesmo valor). Baixa sem liquidação vira pendência e avisa GG, ADM e Contas a Receber. Entrada só confirma; tarifas e juros ficam como ajuste.
      </p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Movimentações ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto max-h-[560px] overflow-y-auto">
            <Table><TableHeader><TableRow>
              <TableHead>Movimento</TableHead><TableHead>Pagador</TableHead><TableHead>Nosso nº</TableHead><TableHead>Seu nº</TableHead>
              <TableHead>Vencimento</TableHead><TableHead>Operação</TableHead><TableHead className="text-right">Valor inicial</TableHead>
              <TableHead className="text-right">Operação R$</TableHead><TableHead>Resultado</TableHead>
            </TableRow></TableHeader>
              <TableBody>{rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground">Nenhuma francesinha importada.</TableCell></TableRow>
              ) : rows.map((r) => {
                const res = RESULT[r.result ?? ""];
                const opVal = r.acao === "ajuste" ? Number(String(r.operacoes_valor ?? "").replace(",", ".")) || r.valor_final : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{day(r.data_movimento)}</TableCell>
                    <TableCell className="text-xs">{r.pagador ?? "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.nosso_numero ?? "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.seu_numero ?? "—"}</TableCell>
                    <TableCell className="text-xs">{day(r.vencimento)}</TableCell>
                    <TableCell className="text-xs">{r.descricao_operacao}</TableCell>
                    <TableCell className="text-right text-xs">{r.valor_inicial != null ? <Money value={Number(r.valor_inicial)} /> : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{opVal != null ? <Money value={Number(opVal)} /> : "—"}</TableCell>
                    <TableCell className="text-xs">{res ? <Badge variant={res.variant} className="text-[10px]">{res.label}</Badge> : "—"}</TableCell>
                  </TableRow>
                );
              })}</TableBody></Table>
          </CardContent></Card>
      )}
    </div>
  );
}

/** Abre depois de marcar PIX como Faturamento: faturamentos do hotel vencendo no dia do PIX e nos 5 dias seguintes. */
export function BillingDueDialog({ hotelId, date, onClose }: { hotelId: string; date: string | null; onClose: () => void }) {
  const to = date ? new Date(new Date(`${date}T12:00:00Z`).getTime() + 5 * 86400000).toISOString().slice(0, 10) : null;
  const from = date ? new Date(new Date(`${date}T12:00:00Z`).getTime() - 2 * 86400000).toISOString().slice(0, 10) : null;
  const { data, isLoading } = useBillingDue(hotelId, from, to);
  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Faturamentos em aberto com vencimento de {day(from)} a {day(to)}</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <div className="max-h-[420px] overflow-y-auto">
            <Table><TableHeader><TableRow><TableHead>Vencimento</TableHead><TableHead>Cliente</TableHead><TableHead>Conta</TableHead><TableHead>Boleto</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>{(data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground">Nenhum faturamento em aberto nesse período.</TableCell></TableRow>
              ) : (data ?? []).map((b) => (
                <TableRow key={b.id}><TableCell className="text-xs">{day(b.boleto_due_date)}</TableCell><TableCell className="text-xs">{b.account_name}</TableCell><TableCell className="text-xs">{b.invoice_number}</TableCell><TableCell className="text-xs">{b.boleto_number ?? "—"}</TableCell><TableCell className="text-right text-xs"><Money value={Number(b.amount ?? 0)} /></TableCell></TableRow>
              ))}</TableBody></Table>
            <p className="text-[11px] text-muted-foreground mt-2">Use esta lista para dar a baixa manual em Contas a Receber.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
