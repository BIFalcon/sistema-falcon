import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { normalizeBank } from "@/lib/investorImportParser";
import { useInvestorMutations, type PayeeJson } from "@/hooks/useInvestors";

const EMPTY = { nome_favorecido: "", documento_favorecido: "", banco: "", agencia: "", conta: "", tipo_chave_pix: "", chave_pix: "", observacao: "" };

export function PayeeFormDialog({ open, onOpenChange, investorId, payee, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; investorId: string; payee: PayeeJson | null; onSaved?: (id: string) => void;
}) {
  const [f, setF] = useState(EMPTY);
  const { savePayee } = useInvestorMutations();
  const masked = !!payee && !payee.full;

  useEffect(() => {
    if (!open) return;
    if (!payee) { setF(EMPTY); return; }
    setF({
      nome_favorecido: payee.nome_favorecido,
      documento_favorecido: masked ? "" : payee.documento_favorecido ?? "",
      banco: payee.banco_codigo ? `${payee.banco_nome ?? ""} ${payee.banco_codigo}`.trim() : payee.banco_nome ?? "",
      agencia: masked ? "" : payee.agencia ?? "",
      conta: masked ? "" : payee.conta ?? "",
      tipo_chave_pix: payee.tipo_chave_pix ?? "",
      chave_pix: masked ? "" : payee.chave_pix ?? "",
      observacao: payee.observacao ?? "",
    });
  }, [open, payee, masked]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    const bank = normalizeBank(f.banco.trim() || null);
    try {
      const id = await savePayee.mutateAsync({
        id: payee?.id ?? null, investorId,
        data: { nome_favorecido: f.nome_favorecido, documento_favorecido: f.documento_favorecido, banco_codigo: bank.codigo, banco_nome: bank.nome,
          agencia: f.agencia, conta: f.conta, tipo_chave_pix: f.chave_pix.trim() ? f.tipo_chave_pix || null : null, chave_pix: f.chave_pix, observacao: f.observacao },
      });
      toast.success("Favorecido salvo");
      onSaved?.(id as string);
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{payee ? "Editar favorecido" : "Novo favorecido"}</DialogTitle>
          {masked && <DialogDescription>Os dados bancários atuais estão ocultos. Preencha documento, agência, conta e chave PIX novamente — campos vazios serão gravados como ausentes.</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1"><Label>Nome do favorecido</Label><Input value={f.nome_favorecido} onChange={set("nome_favorecido")} /></div>
          <div className="space-y-1"><Label>CPF/CNPJ do favorecido</Label><Input value={f.documento_favorecido} onChange={set("documento_favorecido")} /></div>
          <div className="space-y-1"><Label>Banco (nome ou código)</Label><Input value={f.banco} onChange={set("banco")} placeholder="Itaú 341" /></div>
          <div className="space-y-1"><Label>Agência</Label><Input value={f.agencia} onChange={set("agencia")} /></div>
          <div className="space-y-1"><Label>Conta</Label><Input value={f.conta} onChange={set("conta")} /></div>
          <div className="space-y-1">
            <Label>Tipo de chave PIX</Label>
            <Select value={f.tipo_chave_pix || "none"} onValueChange={(v) => setF((s) => ({ ...s, tipo_chave_pix: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem><SelectItem value="cpf">CPF</SelectItem><SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="email">E-mail</SelectItem><SelectItem value="telefone">Telefone</SelectItem><SelectItem value="aleatoria">Aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Chave PIX</Label><Input value={f.chave_pix} onChange={set("chave_pix")} /></div>
          <div className="col-span-2 space-y-1"><Label>Observação</Label><Input value={f.observacao} onChange={set("observacao")} /></div>
        </div>
        <DialogFooter><Button disabled={savePayee.isPending || !f.nome_favorecido.trim()} onClick={save}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
