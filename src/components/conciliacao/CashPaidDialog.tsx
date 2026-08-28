import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrDateInput } from "@/components/ui/br-date-input";
import { Loader2 } from "lucide-react";

/** Dinheiro: marcar lançamentos como pagos (data + comprovante). */
export function CashPaidDialog({
  open, onOpenChange, count, total, saving, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  total: number;
  saving: boolean;
  onConfirm: (paidDate: string, proof: File | null) => void;
}) {
  const [date, setDate] = useState("");
  const [file, setFile] = useState<File | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Marcar dinheiro como pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            {count} lançamento(s) selecionado(s) · total {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Data do pagamento</Label>
            <BrDateInput value={date} onChange={setDate} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Comprovante (opcional)</Label>
            <Input
              type="file"
              className="h-9 text-xs"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" disabled={!date || saving} onClick={() => onConfirm(date, file)}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
