import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useInvestorMutations, useInvestorPayees, useSearchInvestors } from "@/hooks/useInvestors";

export function ChangeInvestorDialog({ open, onOpenChange, unitId, currentInvestorId, mode }: {
  open: boolean; onOpenChange: (o: boolean) => void; unitId: string; currentInvestorId: string | null; mode: "investor" | "payee";
}) {
  const [q, setQ] = useState("");
  const [investorId, setInvestorId] = useState<string | null>(null);
  const [payeeId, setPayeeId] = useState<string>("none");
  const [motivo, setMotivo] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [newInv, setNewInv] = useState(false);
  const [ni, setNi] = useState({ nome: "", documento: "", codigo: "", email: "", telefone: "" });
  const { data: found = [] } = useSearchInvestors(q, open && mode === "investor" && q.trim().length >= 2);
  const { data: payees = [] } = useInvestorPayees(investorId);
  const { changeLink, saveInvestor } = useInvestorMutations();

  useEffect(() => {
    if (!open) return;
    setQ(""); setMotivo(""); setPayeeId("none"); setNewInv(false); setNi({ nome: "", documento: "", codigo: "", email: "", telefone: "" });
    setInvestorId(mode === "payee" ? currentInvestorId : null);
  }, [open, mode, currentInvestorId]);

  const submit = async () => {
    try {
      let inv = investorId;
      if (newInv) inv = (await saveInvestor.mutateAsync({ id: null, ...ni })) as string;
      if (!inv) { toast.error("Escolha o investidor"); return; }
      await changeLink.mutateAsync({ unitId, investorId: inv, payeeId: payeeId === "none" ? null : payeeId, motivo, dataInicio: data });
      toast.success("Vínculo atualizado — o anterior foi encerrado e mantido no histórico.");
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao trocar"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === "investor" ? "Trocar investidor" : "Trocar favorecido"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {mode === "investor" && !newInv && (
            <div className="space-y-1">
              <Label>Buscar investidor (nome ou CPF/CNPJ)</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="max-h-40 overflow-auto rounded border divide-y">
                {found.map((i) => (
                  <button key={i.id} type="button" onClick={() => { setInvestorId(i.id); setPayeeId("none"); }}
                    className={`w-full text-left p-2 text-sm hover:bg-muted ${investorId === i.id ? "bg-muted" : ""}`}>
                    {i.nome} <span className="text-muted-foreground">{i.documento}</span>{!i.ativo && " (inativo)"}
                  </button>
                ))}
              </div>
              <Button variant="link" className="px-0" onClick={() => { setNewInv(true); setInvestorId(null); }}>Cadastrar novo investidor</Button>
            </div>
          )}
          {newInv && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label>Nome</Label><Input value={ni.nome} onChange={(e) => setNi({ ...ni, nome: e.target.value })} /></div>
              <div><Label>CPF/CNPJ</Label><Input value={ni.documento} onChange={(e) => setNi({ ...ni, documento: e.target.value })} /></div>
              <div><Label>E-mail</Label><Input value={ni.email} onChange={(e) => setNi({ ...ni, email: e.target.value })} /></div>
              <div><Label>Telefone</Label><Input value={ni.telefone} onChange={(e) => setNi({ ...ni, telefone: e.target.value })} /></div>
              <p className="col-span-2 text-xs text-muted-foreground">Depois de vincular, cadastre o favorecido no detalhe do investidor.</p>
            </div>
          )}
          {investorId && !newInv && (
            <div className="space-y-1">
              <Label>Favorecido</Label>
              <Select value={payeeId} onValueChange={setPayeeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem favorecido (pendente)</SelectItem>
                  {payees.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome_favorecido} {p.documento ?? ""} — {p.status_dados}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Vigente a partir de</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
            <div><Label>Motivo</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: venda da unidade" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!motivo.trim() || (!investorId && !(newInv && ni.nome.trim())) || changeLink.isPending} onClick={submit}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
