/**
 * Modal de notificação ao GG sobre pendências em Contas a Pagar.
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
import { ISSUE_CATEGORIES, type IssueCategory } from "@/lib/apIssueCategories";

interface NotifyGgDialogProps {
  open: boolean;
  onClose: () => void;
  hotelId: string;
  issueEntries: ApEntry[];
  issueCounts: Record<IssueCategory, number>;
  showApproval: boolean;
  entryIssues: (e: ApEntry) => Set<IssueCategory>;
}

type CatFlags = Record<IssueCategory, boolean>;

export function NotifyGgDialog({
  open,
  onClose,
  hotelId,
  issueEntries,
  issueCounts,
  showApproval,
  entryIssues,
}: NotifyGgDialogProps) {
  const [cats, setCats] = useState<CatFlags>({
    sem_aprovacao: true,
    sem_documento: true,
    valor_divergente: true,
    cnpj_divergente: true,
  });
  const [hideTrivial, setHideTrivial] = useState(true);
  const [hideNd, setHideNd] = useState(false);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [extraEmails, setExtraEmails] = useState<string>("");
  const [sending, setSending] = useState(false);

  const filtered = issueEntries.filter((e) => {
    const issues = entryIssues(e);
    const matches = ISSUE_CATEGORIES.some(
      (cat) => cats[cat.key] && issues.has(cat.key),
    );
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Categorias
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ISSUE_CATEGORIES
              .filter((cat) => cat.key !== "sem_aprovacao" || showApproval)
              .map((cat) => (
                <CatCheckbox
                  key={cat.key}
                  label={cat.label}
                  description={cat.description}
                  count={issueCounts[cat.key]}
                  checked={cats[cat.key]}
                  onChange={(v) => setCats((s) => ({ ...s, [cat.key]: v }))}
                />
              ))}
          </div>

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
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
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

function CatCheckbox({
  label,
  description,
  count,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(!!c)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{description}</p>
      </div>
      <Badge variant="outline" className="shrink-0">{count}</Badge>
    </label>
  );
}
