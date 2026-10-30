import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface Pix { id: string; date: string; description: string; amount: number; cpf_cnpj: string | null }
interface Invoice { id: string; invoice_number: string | null; account_name: string | null; confirmation_number: string | null; transaction_date: string | null; departure_date: string | null; open: number; due_date: string | null }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const cents = (v: number) => Math.round(v * 100);

/** Sugere faturas para Pix de agências; o operador escolhe e aprova. Nada é baixado sozinho. */
export function AgencyPixPanel({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const [agency, setAgency] = useState("TREND");
  const [query, setQuery] = useState("TREND");
  const [pixId, setPixId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const data = useQuery({
    queryKey: ["agency-pix", hotelId, query],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conc_agency_pix_suggestions", { p_hotel: hotelId, p_agency: query });
      if (error) throw error;
      return data as unknown as { pix: Pix[]; invoices: Invoice[] };
    },
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("conc_agency_pix_confirm", { p_bank_id: pixId!, p_invoice_ids: [...picked] });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pix vinculado e faturas marcadas como pagas.");
      setPixId(null); setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["agency-pix"] });
      qc.invalidateQueries({ queryKey: ["conc-bank"] });
      qc.invalidateQueries({ queryKey: ["conc-matches"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pix = data.data?.pix ?? [];
  const invoices = data.data?.invoices ?? [];
  const sel = pix.find((p) => p.id === pixId) ?? null;
  const sum = invoices.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.open, 0);
  const exactCount = (p: Pix) => invoices.filter((i) => cents(i.open) === cents(p.amount)).length;
  const sorted = useMemo(() => {
    if (!sel) return invoices;
    return [...invoices].sort((a, b) => Number(cents(b.open) === cents(sel.amount)) - Number(cents(a.open) === cents(sel.amount)));
  }, [invoices, sel]);
  const balanced = sel && picked.size > 0 && cents(sum) === cents(sel.amount);

  return (
    <div className="space-y-3">
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(agency.trim()); setPixId(null); setPicked(new Set()); }}>
        <div>
          <label className="text-[11px] text-muted-foreground">Agência</label>
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} className="h-8 w-56" />
        </div>
        <Button size="sm" type="submit" variant="outline">Buscar</Button>
        <p className="text-[11px] text-muted-foreground ml-2">Sugestões apenas: valores iguais se repetem, por isso o vínculo é sempre aprovado por você.</p>
      </form>
      {data.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : data.error ? (
        <p className="text-sm text-destructive">{(data.error as Error).message}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border">
            <div className="px-3 py-2 text-xs font-medium border-b">Pix sem conciliação ({pix.length})</div>
            <div className="max-h-[520px] overflow-auto divide-y">
              {pix.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nenhum Pix pendente desta agência.</p>}
              {pix.map((p) => {
                const n = exactCount(p);
                return (
                  <button key={p.id} type="button" onClick={() => { setPixId(p.id); setPicked(new Set()); }}
                    className={cn("w-full text-left px-3 py-2 text-xs hover:bg-muted/50", pixId === p.id && "bg-accent")}>
                    <div className="flex justify-between gap-2"><span className="font-medium">{brl(p.amount)}</span><span>{br(p.date)}</span></div>
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <span className="truncate">{p.description}</span>
                      <Badge variant={n === 1 ? "default" : "secondary"} className="text-[10px]">
                        {n === 0 ? "sem valor igual" : n === 1 ? "1 fatura de mesmo valor" : `${n} faturas de mesmo valor`}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-md border">
            <div className="px-3 py-2 text-xs font-medium border-b flex items-center justify-between gap-2">
              <span>{sel ? `Faturas candidatas para ${brl(sel.amount)}` : "Escolha um Pix ao lado"}</span>
              {sel && (
                <span className={cn("text-[11px]", balanced ? "text-primary" : "text-muted-foreground")}>
                  Selecionado {brl(sum)} · diferença {brl(sel.amount - sum)}
                </span>
              )}
            </div>
            <div className="max-h-[460px] overflow-auto divide-y">
              {sel && sorted.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nenhuma fatura aberta desta agência.</p>}
              {sel && sorted.map((i) => {
                const exact = cents(i.open) === cents(sel.amount);
                return (
                  <label key={i.id} className={cn("flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-muted/50", exact && "bg-primary/5")}>
                    <Checkbox checked={picked.has(i.id)} onCheckedChange={(v) => {
                      const s = new Set(picked); v ? s.add(i.id) : s.delete(i.id); setPicked(s);
                    }} />
                    <div className="flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">Fatura {i.invoice_number ?? "—"} {exact && <Badge className="ml-1 text-[10px]">valor igual</Badge>}</span>
                        <span>{brl(i.open)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {i.account_name} · conf. {i.confirmation_number ?? "—"} · emissão {br(i.transaction_date)} · saída {br(i.departure_date)} · venc. {br(i.due_date)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {sel && (
              <div className="p-3 border-t flex justify-end">
                <Button size="sm" disabled={!balanced || confirm.isPending} onClick={() => confirm.mutate()}>
                  {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aprovar vínculo
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
