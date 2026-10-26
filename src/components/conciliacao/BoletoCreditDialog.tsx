import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL } from "@/lib/formatters";

export type BoletoTarget = { day: string; amount: number; description: string };
const day = (d: string | null) => d ? d.split("-").reverse().join("/") : "—";
const shift = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Mostra as liquidações da francesinha próximas ao crédito de boleto e o faturamento correspondente. */
export function BoletoCreditDialog({ hotelId, target, onClose }: { hotelId: string; target: BoletoTarget | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["boleto-credit", hotelId, target?.day, target?.amount],
    enabled: !!target,
    queryFn: async () => {
      const { data, error } = await supabase.from("conc_francesinha_entries")
        .select("id, data_movimento, pagador, nosso_numero, seu_numero, vencimento, valor_final, descricao_operacao, matched_ar_id")
        .eq("hotel_id", hotelId).eq("acao", "liquidacao").gte("data_movimento", shift(target!.day, -5)).lte("data_movimento", target!.day)
        .order("data_movimento", { ascending: false }).limit(300);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map(r => r.matched_ar_id).filter(Boolean) as string[])];
      const ar = ids.length ? (await supabase.from("ar_to_invoice_entries").select("id, account_name, invoice_number, amount").in("id", ids)).data ?? [] : [];
      const arMap = new Map(ar.map(a => [a.id, a]));
      return (data ?? []).map(r => ({ ...r, ar: r.matched_ar_id ? arMap.get(r.matched_ar_id) : undefined }));
    },
  });
  const rows = q.data ?? [];
  const exact = rows.filter(r => target && Math.abs((r.valor_final ?? 0) - target.amount) < 0.01);
  const byDate = new Map<string, number>();
  rows.forEach(r => r.data_movimento && byDate.set(r.data_movimento, (byDate.get(r.data_movimento) ?? 0) + (r.valor_final ?? 0)));
  const sumDays = [...byDate].filter(([, v]) => target && Math.abs(v - target.amount) < 0.01).map(([d]) => d);
  const highlight = (r: typeof rows[number]) => exact.includes(r) || (!!r.data_movimento && sumDays.includes(r.data_movimento));
  return <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="max-w-5xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle className="pr-6 break-words">{target?.description} · {target ? fmtBRL(target.amount) : ""} · {day(target?.day ?? null)}</DialogTitle></DialogHeader>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : q.isError ? <p role="alert" className="text-destructive">{(q.error as Error).message}</p> : <>
        <p className="text-sm text-muted-foreground">
          {exact.length ? `${exact.length} boleto(s) liquidado(s) com o mesmo valor.` : sumDays.length ? `A soma das liquidações de ${sumDays.map(day).join(", ")} confere com este crédito.` : "Nenhuma liquidação da francesinha confere com este valor nos 5 dias anteriores. Verifique se a francesinha desse período foi importada."}
        </p>
        <Table><TableHeader><TableRow><TableHead>Movimento</TableHead><TableHead>Pagador</TableHead><TableHead>Nosso nº / Seu nº</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Faturamento</TableHead></TableRow></TableHeader>
          <TableBody>{!rows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem liquidações no período.</TableCell></TableRow>}
            {rows.map(r => <TableRow key={r.id} className={highlight(r) ? "bg-primary/10" : ""}>
              <TableCell className="text-xs">{day(r.data_movimento)}</TableCell><TableCell className="text-xs">{r.pagador ?? "—"}</TableCell>
              <TableCell className="text-xs font-mono">{r.nosso_numero ?? "—"} / {r.seu_numero ?? "—"}</TableCell><TableCell className="text-xs">{day(r.vencimento)}</TableCell>
              <TableCell className="text-right text-xs">{fmtBRL(r.valor_final ?? 0)}</TableCell>
              <TableCell className="text-xs">{r.ar ? <>{r.ar.account_name ?? "—"} · NF {r.ar.invoice_number ?? "—"}</> : <Badge variant="destructive">Sem faturamento vinculado</Badge>}</TableCell>
            </TableRow>)}</TableBody></Table>
      </>}
    </DialogContent>
  </Dialog>;
}
