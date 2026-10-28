import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBankReceiptRules } from "@/hooks/useBankReceiptRules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export function BankReceiptRulesPanel({ hotelId }: { hotelId: string }) {
  const query = useBankReceiptRules(hotelId);
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const save = useMutation({ mutationFn: async ({ id, enabled }: { id?: string; enabled?: boolean }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Entre novamente no sistema");
    const response = id ? await supabase.from("conc_bank_receipt_rules").update({ enabled, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", id).eq("hotel_id", hotelId) : await supabase.from("conc_bank_receipt_rules").insert({ hotel_id: hotelId, prefix: prefix.trim(), updated_by: user.id });
    if (response.error) throw response.error;
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-receipt-rules"] }); qc.invalidateQueries({ queryKey: ["conc-rede-receb"] }); setPrefix(""); setConfirmed(false); toast.success("Regra bancária salva"); }, onError: e => toast.error(e.message) });
  return <details className="border-b border-border pb-3"><summary className="text-sm font-medium cursor-pointer">Recebimentos em conta centralizadora</summary><div className="space-y-3 pt-3">
    {query.error && <p role="alert" className="text-destructive text-sm">{query.error.message}</p>}
    {query.data?.map(r => <label key={r.id} className="flex gap-2 text-sm"><Checkbox checked={r.enabled} disabled={save.isPending} onCheckedChange={v => save.mutate({ id: r.id, enabled: v === true })} />{r.prefix}</label>)}
    <Input aria-label="Prefixo de recebimento Rede deste hotel" placeholder="Descrição inicial exata do crédito centralizador" value={prefix} onChange={e => setPrefix(e.target.value)} />
    <label className="flex gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} />Confirmo que este prefixo identifica exclusivamente recebimentos Rede deste hotel.</label>
    <Button size="sm" variant="outline" disabled={prefix.trim().length < 12 || !confirmed || save.isPending} onClick={() => save.mutate({})}><Save className="mr-2 h-4 w-4" />Adicionar regra</Button>
  </div></details>;
}