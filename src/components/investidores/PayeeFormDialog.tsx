import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { normalizeBank } from "@/lib/investorImportParser";
import { useInvestorMutations, type PayeeJson } from "@/hooks/useInvestors";
import { formatDocumento, formatTelefone, validateAgencia, validateConta, validateDocumento, validateEmail, validatePix, validateTelefone } from "@/lib/brValidation";

const EMPTY = { nome_favorecido: "", documento_favorecido: "", email: "", telefone: "", banco: "", agencia: "", conta: "", tipo_conta: "", tipo_chave_pix: "", chave_pix: "", observacao: "" };
type F = typeof EMPTY;

export function PayeeFormDialog({ open, onOpenChange, investorId, payee, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; investorId: string; payee: PayeeJson | null; onSaved?: (id: string) => void;
}) {
  const [f, setF] = useState<F>(EMPTY);
  const { savePayee } = useInvestorMutations();
  const masked = !!payee && !payee.full;

  useEffect(() => {
    if (!open) return;
    if (!payee) { setF(EMPTY); return; }
    setF({
      nome_favorecido: payee.nome_favorecido,
      documento_favorecido: masked ? "" : formatDocumento(payee.documento_favorecido),
      email: payee.email ?? "",
      telefone: formatTelefone(payee.telefone),
      banco: payee.banco_codigo ? `${payee.banco_nome ?? ""} ${payee.banco_codigo}`.trim() : payee.banco_nome ?? "",
      agencia: masked ? "" : payee.agencia ?? "",
      conta: masked ? "" : payee.conta ?? "",
      tipo_conta: payee.tipo_conta ?? "",
      tipo_chave_pix: payee.tipo_chave_pix ?? "",
      chave_pix: masked ? "" : payee.chave_pix ?? "",
      observacao: payee.observacao ?? "",
    });
  }, [open, payee, masked]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const errors = useMemo(() => ({
    documento_favorecido: validateDocumento(f.documento_favorecido),
    email: validateEmail(f.email),
    telefone: validateTelefone(f.telefone),
    agencia: validateAgencia(f.agencia),
    conta: validateConta(f.conta),
    tipo_conta: f.conta.trim() && !f.tipo_conta ? "Escolha corrente ou poupança" : null,
    chave_pix: f.chave_pix.trim() ? validatePix(f.tipo_chave_pix, f.chave_pix) : null,
  }), [f]);
  const hasErrors = Object.values(errors).some(Boolean);

  const save = async () => {
    const bank = normalizeBank(f.banco.trim() || null);
    try {
      const id = await savePayee.mutateAsync({
        id: payee?.id ?? null, investorId,
        data: { nome_favorecido: f.nome_favorecido, documento_favorecido: f.documento_favorecido, email: f.email, telefone: f.telefone,
          banco_codigo: bank.codigo, banco_nome: bank.nome, agencia: f.agencia, conta: f.conta, tipo_conta: f.tipo_conta || null,
          tipo_chave_pix: f.chave_pix.trim() ? f.tipo_chave_pix || null : null, chave_pix: f.chave_pix, observacao: f.observacao },
      });
      toast.success("Favorecido salvo");
      onSaved?.(id as string);
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao salvar"); }
  };

  const field = (k: keyof F, label: string, props: React.ComponentProps<typeof Input> = {}, span2 = false) => (
    <div className={`space-y-1 ${span2 ? "col-span-2" : ""}`}>
      <Label>{label}</Label>
      <Input value={f[k]} onChange={set(k)} aria-invalid={!!errors[k as keyof typeof errors]} {...props} />
      {errors[k as keyof typeof errors] && <p className="text-xs text-destructive">{errors[k as keyof typeof errors]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{payee ? "Editar favorecido" : "Novo favorecido"}</DialogTitle>
          {masked && <DialogDescription>Os dados bancários atuais estão ocultos. Preencha documento, agência, conta e chave PIX novamente — campos vazios serão gravados como ausentes.</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("nome_favorecido", "Nome do favorecido", {}, true)}
          {field("documento_favorecido", "CPF/CNPJ", { placeholder: "000.000.000-00", onBlur: () => setF((s) => ({ ...s, documento_favorecido: formatDocumento(s.documento_favorecido) })) })}
          {field("telefone", "Telefone", { placeholder: "(81) 99999-0000", onBlur: () => setF((s) => ({ ...s, telefone: formatTelefone(s.telefone) })) })}
          {field("email", "E-mail", { type: "email" }, true)}
          <p className="col-span-2 text-xs font-medium text-muted-foreground pt-1">Dados bancários</p>
          {field("banco", "Banco (nome ou código)", { placeholder: "Itaú 341" })}
          <div className="space-y-1">
            <Label>Tipo de conta</Label>
            <Select value={f.tipo_conta || "none"} onValueChange={(v) => setF((s) => ({ ...s, tipo_conta: v === "none" ? "" : v }))}>
              <SelectTrigger aria-invalid={!!errors.tipo_conta}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem><SelectItem value="corrente">Conta corrente</SelectItem><SelectItem value="poupanca">Conta poupança</SelectItem>
              </SelectContent>
            </Select>
            {errors.tipo_conta && <p className="text-xs text-destructive">{errors.tipo_conta}</p>}
          </div>
          {field("agencia", "Agência", { placeholder: "1234 ou 1234-5" })}
          {field("conta", "Conta (com dígito)", { placeholder: "12345-6" })}
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
          {field("chave_pix", "Chave PIX")}
          {field("observacao", "Observação", {}, true)}
        </div>
        <DialogFooter>
          {hasErrors && <span className="text-xs text-destructive mr-auto self-center">Corrija os campos destacados</span>}
          <Button disabled={savePayee.isPending || !f.nome_favorecido.trim() || hasErrors} onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
