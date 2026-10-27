import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, Calculator, Download, FileUp, FileWarning } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDistribution, useDistributionMutations, usePayerAccount, type PaymentStatus } from "@/hooks/useInvestors";
import { logSensitiveExport } from "@/hooks/useRhPayroll";
import { buildRemessa, parseRetorno } from "@/lib/cnab240Itau";
import { fmtDate } from "./StatusSelo";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  pronto: { label: "Pronto", cls: "bg-primary/10 text-primary border-primary/30" },
  bloqueado: { label: "Pendente de cadastro", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
  enviado: { label: "Enviado ao banco", cls: "bg-muted text-foreground border-border" },
  agendado: { label: "Agendado", cls: "bg-muted text-foreground border-border" },
  pago: { label: "Pago", cls: "bg-success/15 text-success border-success/30" },
  rejeitado: { label: "Rejeitado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};
const FORMA: Record<string, string> = { pix: "PIX", cc_itau: "Conta Itaú", poupanca_itau: "Poupança Itaú", ted: "TED" };

export function DistribuicaoTab({ hotelId, canSend }: { hotelId: string | null; canSend: boolean }) {
  const { allowedHotels } = useAuth();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const [year, setYear] = useState(prev.getFullYear());
  const { data, isLoading } = useDistribution(hotelId, month, year, true);
  const muts = useDistributionMutations();
  const [valor, setValor] = useState("");
  const [dataPg, setDataPg] = useState(now.toISOString().slice(0, 10));
  const [payerOpen, setPayerOpen] = useState(false);
  const [statusF, setStatusF] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? "";

  useEffect(() => {
    if (!data) return;
    const v = data.batch?.valor_por_uh ?? data.dre_valor_por_uh;
    setValor(v != null ? String(v).replace(".", ",") : "");
    if (data.batch) setDataPg(data.batch.data_pagamento);
  }, [data]);

  const items = data?.items ?? [];
  const sum = useMemo(() => {
    const by = (st: PaymentStatus[]) => items.filter((i) => st.includes(i.status));
    const tot = (xs: typeof items) => xs.reduce((a, i) => a + Number(i.valor), 0);
    return {
      total: tot(items), pagos: tot(by(["pago"])), enviados: tot(by(["enviado", "agendado"])), prontos: by(["pronto"]).length,
      pend: by(["bloqueado", "rejeitado"]), pendValor: tot(by(["bloqueado", "rejeitado"])),
    };
  }, [items]);
  const shown = statusF === "all" ? items : items.filter((i) => (statusF === "pend" ? ["bloqueado", "rejeitado"].includes(i.status) : i.status === statusF));

  if (!hotelId) return <Card><CardContent className="p-8 text-center text-muted-foreground"><Building2 className="h-6 w-6 mx-auto mb-2" />Escolha um hotel no filtro do topo para ver a distribuição.</CardContent></Card>;

  const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
  const sent = items.some((i) => ["enviado", "agendado", "pago"].includes(i.status));

  const calc = async () => {
    try {
      await muts.createBatch.mutateAsync({ hotelId, month, year, valor: valorNum, data: dataPg });
      toast.success("Distribuição calculada");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao calcular"); }
  };

  const remessa = async () => {
    if (!data?.batch) return;
    try {
      await logSensitiveExport({ module: "investidores_remessa", format: "cnab240", hotelId, month, year });
      const r = await muts.remessaData.mutateAsync(data.batch.id);
      const txt = buildRemessa({ payer: r.payer, items: r.items, dataPagamento: r.data_pagamento });
      const blob = new Blob([txt], { type: "text/plain;charset=us-ascii" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `remessa-distribuicao-${hotelId}-${year}${String(month).padStart(2, "0")}-${r.lote}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      toast.success(`Remessa gerada com ${r.items.length} pagamento(s). Envie o arquivo pelo Itaú e depois importe o retorno.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao gerar remessa"); }
  };

  const retorno = async (f: File) => {
    try {
      const rows = parseRetorno(await f.text());
      if (rows.length === 0) { toast.error("Nenhum pagamento encontrado no arquivo de retorno"); return; }
      const r = await muts.applyReturn.mutateAsync({ rows, fileName: f.name });
      toast.success(`Retorno processado: ${r.pagos} pago(s), ${r.agendados} agendado(s), ${r.rejeitados} rejeitado(s)${r.nao_encontrados ? `, ${r.nao_encontrados} não encontrado(s)` : ""}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao ler retorno"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const exportPend = () => {
    const rows = items.filter((i) => i.status !== "pago").map((i) => ({
      Hotel: hotelName, Competência: `${String(month).padStart(2, "0")}/${year}`, UH: i.codigo_uh, Investidor: i.investidor_nome ?? "", Favorecido: i.favorecido_nome ?? "",
      "Fração (%)": i.percentual != null ? Number(i.percentual) : "", Valor: Number(i.valor), Situação: STATUS[i.status].label, Motivo: i.motivo ?? "", "Códigos do banco": i.ocorrencias ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Pendências");
    XLSX.writeFile(wb, `pendencias-distribuicao-${hotelId}-${year}${String(month).padStart(2, "0")}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>Competência</Label>
          <div className="flex gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[0, 1, 2].map((d) => now.getFullYear() - d).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="space-y-1"><Label>Distribuição por UH</Label><Input className="w-36" value={valor} onChange={(e) => setValor(e.target.value)} disabled={sent} /></div>
        <div className="space-y-1"><Label>Data de pagamento</Label><Input type="date" className="w-40" value={dataPg} onChange={(e) => setDataPg(e.target.value)} disabled={sent} /></div>
        <Button onClick={calc} disabled={sent || !(valorNum > 0) || muts.createBatch.isPending}><Calculator className="h-4 w-4 mr-2" />{data?.batch ? "Recalcular" : "Calcular distribuição"}</Button>
        <div className="ml-auto flex gap-2 flex-wrap">
          {canSend && <Button variant="outline" onClick={() => setPayerOpen(true)}>Conta pagadora</Button>}
          {canSend && <Button variant="outline" disabled={!data?.batch || sum.prontos + sum.pend.length === 0 || muts.remessaData.isPending} onClick={remessa}><Download className="h-4 w-4 mr-2" />Gerar remessa</Button>}
          {canSend && <Button variant="outline" disabled={muts.applyReturn.isPending} onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4 mr-2" />Importar retorno</Button>}
          <Button variant="outline" disabled={items.length === 0} onClick={exportPend}><FileWarning className="h-4 w-4 mr-2" />Relatório de pendências</Button>
          <input ref={fileRef} type="file" accept=".txt,.ret,.RET" className="hidden" onChange={(e) => e.target.files?.[0] && retorno(e.target.files[0])} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {data?.dre_valor_por_uh != null ? `Valor "Por UH" da DRE de ${MESES[month - 1]}/${year}: ${brl(data.dre_valor_por_uh)}.` : `Sem valor "Por UH" na DRE de ${MESES[month - 1]}/${year} — informe manualmente.`}
        {" "}Somente UHs Pool recebem; cada UH é dividida entre os favorecidos pela fração cadastrada.
        {data?.batch?.valor_fonte === "manual" && " Valor ajustado manualmente."}
        {canSend && data && !data.payer_ok && " Cadastre a conta pagadora do hotel antes de gerar a remessa."}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Total a distribuir", brl(sum.total)], ["Pago", brl(sum.pagos)], ["Enviado / agendado", brl(sum.enviados)], [`Pendências (${sum.pend.length})`, brl(sum.pendValor)]].map(([l, v]) => (
          <Card key={l}><CardContent className="p-4"><div className="text-xl font-semibold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <Select value={statusF} onValueChange={setStatusF}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas as situações</SelectItem><SelectItem value="pend">Pendências</SelectItem>
            {(Object.keys(STATUS) as PaymentStatus[]).map((k) => <SelectItem key={k} value={k}>{STATUS[k].label}</SelectItem>)}</SelectContent></Select>
        {data?.batch && <span className="text-xs text-muted-foreground">{data.batch.remessas} remessa(s) gerada(s){data.batch.last_remessa_at ? ` · última em ${fmtDate(data.batch.last_remessa_at)}` : ""}</span>}
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>UH</TableHead><TableHead>Investidor</TableHead><TableHead>Favorecido</TableHead><TableHead className="text-right">Fração</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead>Forma</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {shown.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{isLoading ? "Carregando…" : data?.batch ? "Nenhum item nesta situação." : "Calcule a distribuição do mês para listar os pagamentos."}</TableCell></TableRow>}
            {shown.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium"><Link className="text-primary hover:underline" to={`/investidores/uh/${i.unit_id}`}>{i.codigo_uh}</Link></TableCell>
                <TableCell>{i.investidor_nome ?? "—"}</TableCell>
                <TableCell>{i.favorecido_nome ?? "—"}</TableCell>
                <TableCell className="text-right">{i.percentual != null ? `${Number(i.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</TableCell>
                <TableCell className="text-right">{brl(Number(i.valor))}</TableCell>
                <TableCell>{i.forma ? FORMA[i.forma] : "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS[i.status].cls}>{STATUS[i.status].label}</Badge>
                  {i.status === "pago" && i.data_pago && <div className="text-xs text-muted-foreground">em {fmtDate(i.data_pago)}</div>}
                  {i.motivo && <div className="text-xs text-muted-foreground max-w-xs">{i.motivo}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {canSend && <PayerAccountDialog open={payerOpen} onOpenChange={setPayerOpen} hotelId={hotelId} hotelName={hotelName} />}
    </div>
  );
}

const PAYER_EMPTY = { razao_social: "", cnpj: "", agencia: "", conta: "", dac: "", endereco: "", numero: "", complemento: "", cidade: "", cep: "", uf: "" };

function PayerAccountDialog({ open, onOpenChange, hotelId, hotelName }: { open: boolean; onOpenChange: (o: boolean) => void; hotelId: string; hotelName: string }) {
  const { data } = usePayerAccount(hotelId, open);
  const { savePayer } = useDistributionMutations();
  const [f, setF] = useState(PAYER_EMPTY);
  useEffect(() => { if (open) setF(data ? Object.fromEntries(Object.keys(PAYER_EMPTY).map((k) => [k, (data as unknown as Record<string, string | null>)[k] ?? ""])) as typeof PAYER_EMPTY : PAYER_EMPTY); }, [open, data]);
  const fld = (k: keyof typeof PAYER_EMPTY, label: string, cls = "") => (
    <div className={`space-y-1 ${cls}`}><Label>{label}</Label><Input value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} /></div>
  );
  const save = () => savePayer.mutateAsync({ hotelId, data: f }).then(() => { toast.success("Conta pagadora salva"); onOpenChange(false); }).catch((e) => toast.error(e.message));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Conta pagadora — {hotelName}</DialogTitle>
          <DialogDescription>Conta Itaú de onde saem os pagamentos. Esses dados vão no cabeçalho da remessa.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-6 gap-3">
          {fld("razao_social", "Razão social", "col-span-4")}{fld("cnpj", "CNPJ", "col-span-2")}
          {fld("agencia", "Agência", "col-span-2")}{fld("conta", "Conta (sem dígito)", "col-span-3")}{fld("dac", "Dígito", "col-span-1")}
          {fld("endereco", "Endereço", "col-span-4")}{fld("numero", "Número", "col-span-2")}
          {fld("complemento", "Complemento", "col-span-2")}{fld("cidade", "Cidade", "col-span-2")}{fld("cep", "CEP", "col-span-1")}{fld("uf", "UF", "col-span-1")}
        </div>
        <DialogFooter><Button disabled={savePayer.isPending} onClick={save}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
