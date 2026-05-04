/**
 * Modal de notificação ao GG sobre pendências em Contas a Pagar.
 * Extraído de ContasPagarPage — sem mudança de comportamento.
 */
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notifyGgPendencies, type ApEntry } from "@/hooks/useAccountsPayable";
import { fmtBRL } from "@/lib/formatters";

interface IssueCounts {
  notApproved: number;
  noDoc: number;
  overdue: number;
  divergent: number;
}

interface NotifyGgDialogProps {
  open: boolean;
  onClose: () => void;
  hotelId: string;
  /** Todos os lançamentos com algum problema, sem filtros adicionais. */
  issueEntries: ApEntry[];
  issueCounts: IssueCounts;
  showApproval: boolean;
}

interface NotifyCats {
  notApproved: boolean;
  noDoc: boolean;
  overdue: boolean;
  divergent: boolean;
}

export function NotifyGgDialog({
  open,
  onClose,
  hotelId,
  issueEntries,
  issueCounts,
  showApproval,
}: NotifyGgDialogProps) {
  const [cats, setCats] = useState<NotifyCats>({
    notApproved: true,
    noDoc: true,
    overdue: true,
    divergent: true,
  });
  const [hideTrivial, setHideTrivial] = useState(true);
  const [hideNd, setHideNd] = useState(false);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [sending, setSending] = useState(false);

  // Aplica os filtros do modal sobre os issueEntries recebidos
  const filtered = issueEntries.filter((e) => {
    const overdue = !!e.omie_situation?.toLowerCase().includes("atras");
    const noApproval = showApproval && e.gg_approval !== "approved";
    const noDoc = !e.primary_document_id;
    // divergência não é calculada aqui — issueEntries já chegou pré-filtrado

    const matches =
      (cats.notApproved && noApproval) ||
      (cats.noDoc && noDoc) ||
      (cats.overdue && overdue);
    if (!matches) return false;
    if (hideTrivial && Number(e.amount ?? 0) < 1) return false;
    if (hideNd) {
      const isNd =
        !e.document_number ||
        e.document_number.trim() === "" ||
        e.document_number.toUpperCase() === "N/D";
      if (isNd) return false;
    }
    return true;
  });

  async function handleSend() {
    if (!hotelId || filtered.length === 0) return;
    setSending(true);
    try {
      const r = await notifyGgPendencies({
        hotelId,
        entryIds: filtered.map((e) => e.id),
        dueFrom: dueFrom || null,
        dueTo: dueTo || null,
      });
      if (r.recipients === 0) {
        toast.warning("Nenhum GG cadastrado para este hotel.");
      } else {
        toast.success(`Notificação enfileirada para ${r.recipients} GG(s).`);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao notificar");
    } finally {
      setSending(false);
    }
  }

  const total = filtered.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notificar GG sobre pendências</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Escolha quais categorias de pendência devem ser incluídas no e-mail ao GG.
        </p>

        <div className="space-y-3">
          {/* Categorias */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Categorias
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {showApproval && (
              <CatCheckbox
                label="Sem aprovação GG"
                count={issueCounts.notApproved}
                checked={cats.notApproved}
                onChange={(v) => setCats((s) => ({ ...s, notApproved: v }))}
              />
            )}
            <CatCheckbox
              label="Sem documento"
              count={issueCounts.noDoc}
              checked={cats.noDoc}
              onChange={(v) => setCats((s) => ({ ...s, noDoc: v }))}
            />
            <CatCheckbox
              label="Atrasados"
              count={issueCounts.overdue}
              checked={cats.overdue}
              onChange={(v) => setCats((s) => ({ ...s, overdue: v }))}
            />
            <CatCheckbox
              label="Divergência de valor"
              count={issueCounts.divergent}
              checked={cats.divergent}
              onChange={(v) => setCats((s) => ({ ...s, divergent: v }))}
            />
          </div>

          {/* Filtros de data e trivial */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            Filtros
          </p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Vencimento de
                </label>
                <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Vencimento até
                </label>
                <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={hideTrivial}
                onCheckedChange={(c) => setHideTrivial(!!c)}
              />
              Ocultar lançamentos abaixo de R$ 1,00
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={hideNd} onCheckedChange={(c) => setHideNd(!!c)} />
              Ocultar lançamentos N/D (sem nº de documento)
            </label>
          </div>

          {/* Resumo */}
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            Serão notificados <strong>{filtered.length}</strong> lançamento(s)
            {filtered.length > 0 && (
              <span className="text-muted-foreground"> · total {fmtBRL(total)}</span>
            )}
            .
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || filtered.length === 0}
            className="gap-2"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Enviar notificação ({filtered.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CatCheckbox ──────────────────────────────────────────────────────────────

function CatCheckbox({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} />
      <span className="flex-1 text-sm">{label}</span>
      <Badge variant="outline">{count}</Badge>
    </label>
  );
}
