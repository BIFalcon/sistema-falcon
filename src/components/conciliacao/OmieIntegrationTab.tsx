import { useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Send, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL } from "@/lib/formatters";
import { OMIE_CLIENTE, omieDate, vencimentoB2B, vencimentoPorPrazo } from "@/lib/omieExport";
import {
  useConcMatches, useEntriesByIds, useSetOmieSent, useTrxCodeMapping,
} from "@/hooks/useConciliacaoCartao";
import templateAsset from "@/assets/omie-contas-receber.xlsx.asset.json";

type Tipo = "Cartão" | "B2B" | "PIX";

interface OmieRow {
  id: string; // id da venda da adquirente
  tipo: Tipo;
  categoria: string;
  conta: string;
  valor: number | null;
  emissao: string;
  vencimento: string | null;
  nsu: string;
  sentAt: string | null;
  trx: string;
}

interface Props {
  hotelId: string;
  dateFrom: string;
  dateTo: string;
  specificDates: string[];
}

export function OmieIntegrationTab({ hotelId, dateFrom, dateTo, specificDates }: Props) {
  const cardMatches = useConcMatches(hotelId, "cartao");
  const pixMatches = useConcMatches(hotelId, "pix_extrato");
  const matches = useMemo(
    () => ({ data: [...(cardMatches.data ?? []), ...(pixMatches.data ?? [])], isLoading: cardMatches.isLoading || pixMatches.isLoading }),
    [cardMatches.data, pixMatches.data, cardMatches.isLoading, pixMatches.isLoading],
  );
  const mapping = useTrxCodeMapping();
  const setSent = useSetOmieSent();
  const [showSent, setShowSent] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const ids = useMemo(
    () => (matches.data ?? []).flatMap((m) => m.conc_match_items.map((i) => i.entry_id)),
    [matches.data],
  );
  const entries = useEntriesByIds(ids);

  const inPeriod = (d: string | null) => {
    if (!d) return false;
    if (specificDates.length) return specificDates.includes(d);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  };

  const rows = useMemo<OmieRow[]>(() => {
    if (!entries.data) return [];
    const acqById = new Map(entries.data.acq.map((a) => [a.id, a]));
    const opById = new Map(entries.data.opera.map((o) => [o.id, o]));
    const codeMap = new Map((mapping.data ?? []).map((c) => [c.trx_code.trim(), c]));
    const out: OmieRow[] = [];
    for (const m of matches.data ?? []) {
      const ops = m.conc_match_items.filter((i) => i.side === "opera").map((i) => opById.get(i.entry_id)).filter(Boolean);
      const acqs = m.conc_match_items.filter((i) => i.side === "acquirer").map((i) => acqById.get(i.entry_id)).filter(Boolean);
      if (!ops.length || !acqs.length) continue;
      const op = [...ops].sort((a, b) => (a!.business_date ?? "").localeCompare(b!.business_date ?? ""))[0]!;
      if (!inPeriod(op.business_date)) continue;
      const code = codeMap.get(op.trx_code.trim());
      for (const a of acqs) {
        const isB2B = a!.source === "b2b";
        const isPix = m.kind === "pix_extrato" || String(a!.categoria ?? "").toUpperCase().includes("PIX");
        out.push({
          id: a!.id,
          tipo: isB2B ? "B2B" : isPix ? "PIX" : "Cartão",
          categoria: code?.categoria_omie ?? "",
          conta: code?.conta_corrente_omie ?? "",
          valor: a!.valor_liquido ?? null,
          emissao: op.business_date ?? "",
          vencimento: isB2B ? vencimentoB2B(a!.sale_date) : vencimentoPorPrazo(a!.sale_date, a!.prazo_recebimento),
          nsu: (isB2B ? a!.codigo_reserva : a!.nsu) ?? "",
          sentAt: a!.omie_sent_at ?? null,
          trx: op.trx_code,
        });
      }
    }
    return out.sort((x, y) => x.emissao.localeCompare(y.emissao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.data, matches.data, mapping.data, dateFrom, dateTo, specificDates]);

  const visible = rows.filter((r) => (showSent ? !!r.sentAt : !r.sentAt));
  const allSel = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const missing = (r: OmieRow) => !r.categoria || !r.conta || r.valor == null || !r.vencimento || !r.nsu;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportXlsx = async () => {
    const list = visible.filter((r) => sel.size === 0 || sel.has(r.id));
    if (!list.length) { toast.error("Nenhuma linha para exportar."); return; }
    const buf = await (await fetch(templateAsset.url)).arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellStyles: true });
    const ws = wb.Sheets["Omie_Contas_Receber"];
    const data = list.map((r) => {
      const line: (string | number)[] = new Array(41).fill(""); // colunas B..AP
      line[1] = OMIE_CLIENTE;               // C Cliente
      line[2] = r.categoria;                // D Categoria
      line[3] = r.conta;                    // E Conta Corrente
      line[4] = r.valor ?? "";              // F Valor da Conta
      line[7] = omieDate(r.emissao);        // I Data de Emissão
      line[8] = omieDate(r.emissao);        // J Data de Registro
      line[9] = omieDate(r.vencimento);     // K Data de Vencimento
      line[17] = `Integração Sistema Falcon ${r.tipo}`; // S Observações
      line[23] = r.nsu;                     // Y Nota Fiscal
      line[27] = r.nsu;                     // AC NSU / TID
      return line;
    });
    XLSX.utils.sheet_add_aoa(ws, data, { origin: "B6" });
    XLSX.writeFile(wb, `omie-contas-receber-${hotelId}.xlsx`);
  };

  const mark = (value: boolean) => {
    const list = [...sel].filter((id) => visible.some((r) => r.id === id));
    if (!list.length) return;
    setSent.mutate({ ids: list, value }, {
      onSuccess: () => { toast.success(value ? `${list.length} marcada(s) como enviadas ao OMIE` : `${list.length} voltaram para a lista`); setSel(new Set()); },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const loading = matches.isLoading || entries.isLoading;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Conciliações de Cartão e B2B já casadas, no formato de importação do OMIE. Período pela data do Opera.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch id="omie-sent" checked={showSent} onCheckedChange={(v) => { setShowSent(v); setSel(new Set()); }} />
              <Label htmlFor="omie-sent" className="text-xs">Mostrar já enviadas</Label>
            </div>
            {showSent ? (
              <Button size="sm" variant="outline" disabled={!sel.size || setSent.isPending} onClick={() => mark(false)}>
                <Undo2 className="h-3.5 w-3.5 mr-1" /> Desmarcar envio
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={!sel.size || setSent.isPending} onClick={() => mark(true)}>
                <Send className="h-3.5 w-3.5 mr-1" /> Marcar como enviadas
              </Button>
            )}
            <Button size="sm" onClick={exportXlsx} disabled={!visible.length}>
              <Download className="h-3.5 w-3.5 mr-1" /> {sel.size ? `Exportar seleção (${sel.size})` : "Exportar planilha OMIE"}
            </Button>
          </div>
        </div>

        {loading ? <p className="text-xs text-muted-foreground">Carregando…</p> : (
          <div className="overflow-auto max-h-[600px]">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allSel} onCheckedChange={(v) => setSel(v ? new Set(visible.map((r) => r.id)) : new Set())} />
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Conta Corrente</TableHead>
                  <TableHead className="text-right">Valor da Conta</TableHead>
                  <TableHead>Emissão / Registro</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>NSU / TID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhuma conciliação neste período.</TableCell></TableRow>
                )}
                {visible.map((r) => (
                  <TableRow key={r.id} className={missing(r) ? "bg-destructive/5" : undefined}>
                    <TableCell><Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                    <TableCell>{r.tipo}</TableCell>
                    <TableCell className="font-mono">{OMIE_CLIENTE}</TableCell>
                    <TableCell>{r.categoria || <span className="text-destructive">falta (TRX {r.trx})</span>}</TableCell>
                    <TableCell>{r.conta || <span className="text-destructive">falta (TRX {r.trx})</span>}</TableCell>
                    <TableCell className="text-right">{r.valor != null ? fmtBRL(r.valor) : <span className="text-destructive">reimportar</span>}</TableCell>
                    <TableCell>{omieDate(r.emissao)}</TableCell>
                    <TableCell>{r.vencimento ? omieDate(r.vencimento) : <span className="text-destructive">sem prazo</span>}</TableCell>
                    <TableCell className="font-mono">{r.nsu || <span className="text-destructive">reimportar</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Linhas em vermelho têm campo faltando: cadastre Categoria/Conta OMIE no código TRX ou reimporte a planilha da Rede/B2B para trazer valor líquido, NSU e prazo.
        </p>
      </CardContent>
    </Card>
  );
}
