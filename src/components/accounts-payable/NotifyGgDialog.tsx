/**
 * Modal simplificado de notificação ao GG.
 */
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { notifyGgPendencies, type ApEntry } from "@/hooks/useAccountsPayable";
import { fmtBRL } from "@/lib/formatters";

interface NotifyGgDialogProps {
  open: boolean;
  onClose: () => void;
  hotelId: string;
  selectedEntries: ApEntry[];
}

export function NotifyGgDialog({
  open,
  onClose,
  hotelId,
  selectedEntries,
}: NotifyGgDialogProps) {
  const [extraEmails, setExtraEmails] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const total = selectedEntries.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  async function handleSend() {
    setSending(true);
    try {
      await notifyGgPendencies({
        hotelId,
        entryIds: selectedEntries.map((e) => e.id),
        extraEmails: extraEmails
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        message: message.trim() || null,
      });
      toast.success("Notificação enviada ao GG.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao notificar");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Notificar GG sobre pendências</DialogTitle>
          <DialogDescription>
            {selectedEntries.length} lançamento(s) selecionado(s) · total {fmtBRL(total)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              E-mails adicionais (separados por vírgula)
            </label>
            <Input
              placeholder="email1@exemplo.com, email2@exemplo.com"
              value={extraEmails}
              onChange={(e) => setExtraEmails(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Receberão a notificação mesmo sem cadastro no sistema.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              Mensagem adicional (opcional)
            </label>
            <Textarea
              placeholder="Escreva um recado para o GG..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSend}
            disabled={sending || selectedEntries.length === 0}
            className="gap-2"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Enviar notificação ({selectedEntries.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
