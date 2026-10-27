import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useInvestorMutations, useInvestorPayees, type PayeeShare } from "@/hooks/useInvestors";
import { equalShares, sharesSumOk } from "@/lib/brValidation";

export function PayeeSharesDialog({ open, onOpenChange, unitId, investorId, shares, onNewPayee }: {
  open: boolean; onOpenChange: (o: boolean) => void; unitId: string; investorId: string; shares: PayeeShare[]; onNewPayee: () => void;
}) {
  const { data: payees = [] } = useInvestorPayees(open ? investorId : null);
  const { setShares } = useInvestorMutations();
  const [pct, setPct] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const m: Record<string, string> = {};
    shares.forEach((s) => { m[s.payee.id] = String(s.percentual); });
    setPct(m);
  }, [open, shares]);

  const selected = Object.keys(pct);
  const nums = selected.map((id) => Number(String(pct[id]).replace(",", ".")));
  const sum = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const ok = sharesSumOk(nums);

  const toggle = (id: string, on: boolean) => setPct((s) => { const n = { ...s }; if (on) n[id] = ""; else delete n[id]; return n; });
  const split = () => { const parts = equalShares(selected.length); setPct(Object.fromEntries(selected.map((id, i) => [id, String(parts[i])]))); };

  const save = async () => {
    try {
      await setShares.mutateAsync({ unitId, shares: selected.map((id, i) => ({ payee_id: id, percentual: nums[i] })) });
      toast.success("Rateio de favorecidos salvo");
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Favorecidos e frações</DialogTitle>
          <DialogDescription>Escolha quem recebe a distribuição desta UH e a fração de cada um. A soma precisa ser 100%.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {payees.length === 0 && <p className="text-sm text-muted-foreground">Este investidor ainda não tem favorecidos cadastrados.</p>}
          {payees.map((p) => {
            const on = p.id in pct;
            return (
              <div key={p.id} className="flex items-center gap-3 rounded border p-2">
                <Checkbox checked={on} onCheckedChange={(c) => toggle(p.id, !!c)} />
                <div className="flex-1 min-w-0 text-sm"><div className="font-medium truncate">{p.nome_favorecido}</div><div className="text-xs text-muted-foreground">{p.documento ?? "sem documento"}</div></div>
                <div className="flex items-center gap-1">
                  <Input className="w-24 text-right" inputMode="decimal" disabled={!on} value={pct[p.id] ?? ""} onChange={(e) => setPct((s) => ({ ...s, [p.id]: e.target.value }))} />
                  <span className="text-sm">%</span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm pt-1">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={selected.length < 2} onClick={split}>Dividir igualmente</Button>
              <Button size="sm" variant="ghost" onClick={onNewPayee}>+ Novo favorecido</Button>
            </div>
            <span className={ok ? "text-success font-medium" : "text-destructive font-medium"}>Soma: {sum.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>
          </div>
        </div>
        <DialogFooter><Button disabled={!ok || setShares.isPending} onClick={save}>Salvar rateio</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
