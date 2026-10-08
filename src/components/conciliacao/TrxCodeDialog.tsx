import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveTrxCode, type TrxCodeMap } from "@/hooks/useConciliacaoCartao";

/** Valores fixos de "Base de Conciliação" (campo categoria). */
export const TRX_BASES = ["CARTAO", "PIX", "DINHEIRO", "FATURADO"] as const;

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Código a editar; null = novo cadastro. */
  code: TrxCodeMap | null;
  /** Abre já com "Ativo" ligado (fluxo de ativar código sem base). */
  activate?: boolean;
}

export function TrxCodeDialog({ open, onOpenChange, code, activate }: Props) {
  const save = useSaveTrxCode();
  const [trx, setTrx] = useState("");
  const [desc, setDesc] = useState("");
  const [base, setBase] = useState<string>(NONE);
  const [ativo, setAtivo] = useState(false);
  const [catOmie, setCatOmie] = useState("");
  const [ccOmie, setCcOmie] = useState("");

  useEffect(() => {
    if (!open) return;
    setTrx(code?.trx_code ?? "");
    setDesc(code?.descricao ?? "");
    setBase(code?.categoria?.trim() ? code.categoria : NONE);
    setAtivo(activate ? true : code?.ativo ?? false);
    setCatOmie(code?.categoria_omie ?? "");
    setCcOmie(code?.conta_corrente_omie ?? "");
  }, [open, code, activate]);

  // Valores antigos fora da lista fixa continuam selecionáveis (compatibilidade).
  const legacy = base !== NONE && !TRX_BASES.includes(base as (typeof TRX_BASES)[number]) ? base : null;
  const canSave = trx.trim() && (!ativo || base !== NONE) && !save.isPending;

  const submit = () => {
    save.mutate(
      {
        id: code?.id,
        trx_code: trx.trim(),
        descricao: desc.trim() || null,
        categoria: base === NONE ? null : base,
        ativo,
        categoria_omie: catOmie.trim() || null,
        conta_corrente_omie: ccOmie.trim() || null,
      },
      {
        onSuccess: () => { toast.success(code ? "Código atualizado" : "Código cadastrado"); onOpenChange(false); },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-sm">{code ? `Editar código ${code.trx_code}` : "Novo código TRX"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <Label className="text-xs">Código</Label>
            <Input className="h-9 text-xs font-mono" value={trx} onChange={(e) => setTrx(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descrição</Label>
            <Input className="h-9 text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Base de Conciliação</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">— Sem base —</SelectItem>
                {TRX_BASES.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
                {legacy && <SelectItem value={legacy} className="text-xs">{legacy} (atual)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Categoria OMIE</Label>
            <Input className="h-9 text-xs" value={catOmie} onChange={(e) => setCatOmie(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Conta Corrente OMIE</Label>
            <Input className="h-9 text-xs" value={ccOmie} onChange={(e) => setCcOmie(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Ativo</Label>
            <Switch checked={ativo} onCheckedChange={setAtivo} />
          </div>
          {ativo && base === NONE && (
            <p className="text-[11px] text-destructive">Defina a base de conciliação para ativar o código.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" disabled={!canSave} onClick={submit}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
