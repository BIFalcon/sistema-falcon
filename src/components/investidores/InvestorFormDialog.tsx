import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useInvestorMutations, type InvestorDetail } from "@/hooks/useInvestors";

type Inv = InvestorDetail["investor"];

export function InvestorFormDialog({ open, onOpenChange, investor }: { open: boolean; onOpenChange: (o: boolean) => void; investor: Inv }) {
  const [f, setF] = useState({ nome: "", documento: "", codigo: "", email: "", telefone: "" });
  const { saveInvestor } = useInvestorMutations();

  useEffect(() => {
    if (!open) return;
    setF({ nome: investor.nome, documento: investor.documento ?? "", codigo: investor.codigo_externo ?? "", email: investor.email ?? "", telefone: investor.telefone ?? "" });
  }, [open, investor]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    try {
      await saveInvestor.mutateAsync({ id: investor.id, ...f });
      toast.success("Dados do investidor salvos");
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar investidor</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 space-y-1"><Label>Nome</Label><Input value={f.nome} onChange={set("nome")} /></div>
          <div className="space-y-1"><Label>CPF/CNPJ</Label><Input value={f.documento} onChange={set("documento")} /></div>
          <div className="space-y-1"><Label>E-mail</Label><Input value={f.email} onChange={set("email")} /></div>
          <div className="space-y-1"><Label>Telefone</Label><Input value={f.telefone} onChange={set("telefone")} /></div>
        </div>
        <DialogFooter><Button disabled={saveInvestor.isPending || !f.nome.trim()} onClick={save}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
