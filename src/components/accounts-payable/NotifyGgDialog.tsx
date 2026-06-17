/**
 * Modal simplificado de notificação ao GG.
 */
import { useEffect, useState } from "react";
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
import { notifyGgPendencies, useSaveNotificationLog, type ApEntry } from "@/hooks/useAccountsPayable";
import { fmtBRL, fmtDate } from "@/lib/formatters";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user } = useAuth();
  const [extraEmails, setExtraEmails] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const saveLog = useSaveNotificationLog();

  const total = selectedEntries.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  // Chave de storage para lembrar os últimos e-mails extras usados
  // (por usuário + hotel). Evita que o financeiro precise redigitar.
  const storageKey = user ? `notify-gg-ap:extra-emails:${user.id}:${hotelId}` : null;

  // Pré-popula a mensagem + recupera os últimos e-mails extras salvos.
  useEffect(() => {
    if (!open) return;
    const lines = selectedEntries.map((e) => {
      const obs = e.observation ? `\n  Obs: ${e.observation}` : "";
      return `• ${e.supplier} — ${fmtBRL(Number(e.amount))} (vence ${fmtDate(e.due_date)})${obs}`;
    });
    setMessage(lines.join("\n"));
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        setExtraEmails(saved ?? "");
      } catch {
        // ignora erros de storage (modo privado, etc.)
        setExtraEmails("");
      }
    } else {
      setExtraEmails("");
    }
  }, [open, selectedEntries, storageKey]);

  async function handleSend() {
    setSending(true);
    try {
      // Aceita e-mails separados por vírgula, ponto-e-vírgula, espaço ou quebra de linha,
      // e ignora nomes/textos extras (ex.: "Silmara silmara.carlos@accor.com").
      const emails = Array.from(
        new Set(
          (extraEmails.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((s) =>
            s.trim().toLowerCase(),
          ),
        ),
      );
      const entryIds = selectedEntries.map((e) => e.id);
      await notifyGgPendencies({
        hotelId,
        entryIds,
        extraEmails: emails,
        message: message.trim() || null,
      });
      if (user) {
        try {
          await saveLog.mutateAsync({
            hotelId,
            sentBy: user.id,
            entryIds,
            recipientEmails: emails,
            messageText: message.trim(),
            entriesSnapshot: selectedEntries.map((e) => ({
              supplier: e.supplier,
              amount: e.amount,
              due_date: e.due_date,
              observation: e.observation,
            })),
          });
        } catch {
          // log é melhor-esforço — não falha o envio
        }
      }
      toast.success("Notificação enviada ao GG.");
      // Persiste os e-mails extras (mesmo string crua) para reuso na próxima vez.
      if (storageKey) {
        try {
          if (extraEmails.trim()) {
            localStorage.setItem(storageKey, extraEmails.trim());
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch {
          // ignora erros de storage
        }
      }
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
