/**
 * Linha da tabela de lançamentos de Contas a Pagar.
 */
import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, Banknote, CalendarClock, CheckCircle2, CircleDashed, Clock, MessageSquare, Pencil, ShieldCheck, Unlink, UserPlus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useUpdateEntryObservation, useUpdateEntryCategory, useUngroupEntries, useUpdateEntryAmount, useUpdateEntryPaidValues, useUpdateManualEntry, type ApEntry, type ApPaymentStatus, type FinancialSystem } from "@/hooks/useAccountsPayable";
import { fmtBRL, fmtDate } from "@/lib/formatters";
import type { IssueCategory } from "@/lib/apIssueCategories";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EntryRowProps {
  entry: ApEntry;
  sourceSystem: FinancialSystem | null;
  showApproval?: boolean;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (v: boolean) => void;
  issues?: Set<IssueCategory>;
  showBank?: boolean;
  canEditObservation?: boolean;
  canManageCategory?: boolean;
  canManage?: boolean;
  /** Quando definido, renderiza uma célula extra com o nome do hotel (modo "todos os hotéis"). */
  hotelLabel?: string;
  showOriginalAmount?: boolean;
  showPaidAmount?: boolean;
  showPaidInterest?: boolean;
  /** Linha de Distribuição de Lucros — não exibe status de aprovação GG. */
  isDistribution?: boolean;
}

export function ApEntryRow({
  entry,
  sourceSystem,
  showApproval = true,
  compact = false,
  selectable = false,
  selected = false,
  onToggleSelected,
  issues,
  showBank = false,
  canEditObservation = false,
  canManageCategory = false,
  canManage = false,
  hotelLabel,
  showOriginalAmount = true,
  showPaidAmount = true,
  showPaidInterest = true,
  isDistribution = false,
}: EntryRowProps) {
  const overdue = entry.omie_situation?.toLowerCase().includes("atras");
  const archived = !!entry.archived_at;

  const paymentRowClass =
    entry.payment_status === "pago"
      ? "bg-emerald-500/10 dark:bg-emerald-500/10"
      : entry.payment_status === "pago_parcialmente"
      ? "bg-yellow-500/10 dark:bg-yellow-500/10"
      : entry.payment_status === "agendado"
      ? "bg-violet-500/10 dark:bg-violet-500/10"
      : "";

  const canEditPaidValues = !archived && (Number(entry.amount) === 0.01 || !!entry.is_manual);

  return (
    <TableRow
      className={`${paymentRowClass} ${!paymentRowClass && overdue ? "bg-destructive/5" : ""} ${archived ? "opacity-60" : ""}`}
    >
      {selectable && (
        <TableCell className="w-8 px-2 py-1.5">
          <Checkbox
            checked={selected}
            onCheckedChange={(c) => onToggleSelected?.(!!c)}
            aria-label="Selecionar lançamento"
          />
        </TableCell>
      )}
      {hotelLabel !== undefined && (
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-2 py-1.5">
          {hotelLabel}
        </TableCell>
      )}
      {/* Fornecedor */}
      <TableCell className="font-medium text-xs px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span>{entry.supplier}</span>
          {archived && (
            <Badge variant="outline" className="text-[10px]">
              Arquivado
            </Badge>
          )}
          {entry.is_manual && (
            <>
              <Badge
                variant="outline"
                className="text-[10px] gap-1 border-sky-500/40 text-sky-700 dark:text-sky-400"
                title="Lançamento manual"
              >
                <UserPlus className="h-3 w-3" /> Manual
              </Badge>
              {canManage && !archived && <EditManualEntryButton entry={entry} />}
            </>
          )}
          {entry.is_transfer && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-slate-500/40 text-slate-700 dark:text-slate-300"
              title={`Transferência ${entry.transfer_from_bank ?? ""} → ${entry.transfer_to_bank ?? ""}`}
            >
              <ArrowRightLeft className="h-3 w-3" /> Transferência
            </Badge>
          )}
          {entry.is_group && canManage && <UngroupButton entry={entry} />}
          {issues?.has("cnpj_divergente") && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-destructive/40 text-destructive"
            >
              <AlertTriangle className="h-3 w-3" /> CNPJ divergente
            </Badge>
          )}
          {issues?.has("valor_divergente") && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" /> Valor divergente
            </Badge>
          )}
        </div>
      </TableCell>

      {/* CNPJ — só OMIE e não-compact */}
      {!compact && sourceSystem === "omie" && (
        <TableCell className="text-xs text-muted-foreground hidden md:table-cell px-2 py-1.5 max-w-[100px] truncate">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block truncate">{entry.cnpj ?? "—"}</span>
              </TooltipTrigger>
              {entry.cnpj && (
                <TooltipContent side="top"><p className="text-xs">{entry.cnpj}</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      )}

      {/* Nº Doc — não-compact */}
      {!compact && (
        <TableCell className="text-xs hidden md:table-cell px-2 py-1.5">{entry.document_number ?? "—"}</TableCell>
      )}

      {/* Vencimento */}
      <TableCell className="text-xs px-2 py-1.5">{fmtDate(entry.due_date)}</TableCell>

      {/* Valor */}
      <TableCell className="text-right font-mono text-xs px-2 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <span>{fmtBRL(Number(entry.amount))}</span>
          {canManage && !archived && (Number(entry.amount) === 0.01 || entry.is_manual) && (
            <EditAmountButton entry={entry} allowAny={!!entry.is_manual} />
          )}
        </div>
      </TableCell>

      {/* Valor Original */}
      {showOriginalAmount && (
        <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell px-2 py-1.5">
          {entry.original_amount != null ? fmtBRL(Number(entry.original_amount)) : "—"}
        </TableCell>
      )}

      {/* Valor Novo (pago com juros) */}
      {showPaidAmount && (
        <TableCell className="text-right font-mono text-xs hidden lg:table-cell px-2 py-1.5">
          <div className="flex items-center justify-end gap-1">
            <span>{entry.paid_amount != null ? fmtBRL(Number(entry.paid_amount)) : "—"}</span>
            {canManage && canEditPaidValues && <EditPaidValuesButton entry={entry} field="paid_amount" />}
          </div>
        </TableCell>
      )}

      {/* Juros / Desconto */}
      {showPaidInterest && (
        <TableCell className="text-right font-mono text-xs hidden lg:table-cell px-2 py-1.5">
          <div className="flex items-center justify-end gap-1">
            {entry.paid_interest != null && Number(entry.paid_interest) !== 0 ? (
              Number(entry.paid_interest) > 0 ? (
                <span className="text-amber-700 dark:text-amber-400">
                  {fmtBRL(Number(entry.paid_interest))}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400">
                  -{fmtBRL(Math.abs(Number(entry.paid_interest)))} <span className="text-[10px] uppercase">desc.</span>
                </span>
              )
            ) : (
              <span>—</span>
            )}
            {canManage && canEditPaidValues && <EditPaidValuesButton entry={entry} field="paid_interest" />}
          </div>
        </TableCell>
      )}

      {/* Categoria — não-compact */}
      {!compact && (
        <TableCell className="text-xs text-muted-foreground hidden lg:table-cell px-2 py-1.5 max-w-[120px]">
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block truncate max-w-[120px]">
                    {entry.category ?? entry.payment_method ?? "—"}
                  </span>
                </TooltipTrigger>
                {(entry.category || entry.payment_method) && (
                  <TooltipContent side="top">
                    <p className="text-xs">{entry.category ?? entry.payment_method}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {/* botão "Salários RH" foi movido para a barra de ações em lote */}
          </div>
        </TableCell>
      )}

      {/* Conta corrente (Itaú/Santander) */}
      {!compact && showBank && (
        <TableCell className="text-xs text-muted-foreground hidden lg:table-cell capitalize px-2 py-1.5">
          {entry.bank_account ?? "—"}
        </TableCell>
      )}

      {/* Aprovação GG */}
      {showApproval && (
        <TableCell className="px-2 py-1.5">
          <ApprovalBadge status={entry.gg_approval} />
        </TableCell>
      )}

      {/* Agendado para */}
      <TableCell className="text-xs hidden md:table-cell px-2 py-1.5">
        {entry.payment_status === "agendado" && entry.scheduled_date ? (
          <span className={isScheduledOverdue(entry.scheduled_date) ? "text-destructive font-semibold" : ""}>
            {fmtDate(entry.scheduled_date)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Status de pagamento */}
      {!compact && (
        <TableCell className="px-2 py-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            <PaymentStatusBadge status={entry.payment_status} isDistribution={isDistribution} />
            {entry.is_pending && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
                title="Marcado como pendente"
              >
                <Clock className="h-3 w-3" /> Pendente
              </Badge>
            )}
            {canEditObservation && (
              <ObservationButton entryId={entry.id} hotelId={entry.hotel_id} initial={entry.observation ?? ""} />
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function isScheduledOverdue(scheduledDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(scheduledDate + "T00:00:00");
  return d.getTime() < today.getTime();
}

function UngroupButton({ entry }: { entry: ApEntry }) {
  const ungroup = useUngroupEntries();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 px-2 text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
      disabled={ungroup.isPending}
      title="Desagrupar este lançamento e restaurar os originais"
      onClick={async () => {
        if (!confirm(`Desagrupar este lançamento? Os ${entry.grouped_ids?.length ?? 0} lançamentos originais serão restaurados.`)) return;
        try {
          await ungroup.mutateAsync({ groupId: entry.id, hotelId: entry.hotel_id });
          toast.success("Lançamentos desagrupados.");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Erro ao desagrupar");
        }
      }}
    >
      <Unlink className="h-3 w-3" />
      {ungroup.isPending ? "Desagrupando..." : "Desagrupar"}
    </Button>
  );
}

function EditAmountButton({ entry, allowAny = false }: { entry: ApEntry; allowAny?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const update = useUpdateEntryAmount();
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setValue(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground"
          title={allowAny ? "Editar valor do lançamento manual" : "Editar valor (lançamento OMIE com valor 0,01)"}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="end">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Corrigir valor
        </p>
        <p className="text-[11px] text-muted-foreground">
          {allowAny
            ? "Lançamento manual. Informe o novo valor correto."
            : "Lançamento veio do OMIE com R$ 0,01. Informe o valor correto."}
        </p>
        <Input
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0,00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            size="sm"
            disabled={
              update.isPending ||
              !value ||
              Number.isNaN(parseFloat(value)) ||
              parseFloat(value) <= 0
            }
            onClick={async () => {
              try {
                await update.mutateAsync({
                  entryId: entry.id,
                  hotelId: entry.hotel_id,
                  amount: parseFloat(value),
                  allowAny,
                });
                toast.success("Valor atualizado");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
              }
            }}
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditPaidValuesButton({
  entry,
  field,
}: {
  entry: ApEntry;
  field: "paid_amount" | "paid_interest";
}) {
  const [open, setOpen] = useState(false);
  const current = field === "paid_amount" ? entry.paid_amount : entry.paid_interest;
  const [value, setValue] = useState<string>(current != null ? String(current) : "");
  const update = useUpdateEntryPaidValues();

  const label = field === "paid_amount" ? "Valor Novo (pago)" : "Juros / Desconto";
  const help =
    field === "paid_amount"
      ? "Informe o valor efetivamente pago (deixe em branco para limpar)."
      : "Use positivo para juros e negativo para desconto. Deixe em branco para limpar.";

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setValue(current != null ? String(current) : "");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground"
          title={`Editar ${label}`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="end">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground">{help}</p>
        <Input
          type="number"
          step="0.01"
          placeholder="0,00 (vazio = limpar)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={async () => {
              const trimmed = value.trim();
              let parsed: number | null = null;
              if (trimmed !== "") {
                const n = parseFloat(trimmed);
                if (Number.isNaN(n)) {
                  toast.error("Valor inválido");
                  return;
                }
                parsed = n;
              }
              try {
                await update.mutateAsync({
                  entryId: entry.id,
                  hotelId: entry.hotel_id,
                  [field === "paid_amount" ? "paidAmount" : "paidInterest"]: parsed,
                } as Parameters<typeof update.mutateAsync>[0]);
                toast.success(parsed == null ? `${label} removido` : `${label} atualizado`);
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
              }
            }}
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SalariosRhToggle({
  entryId,
  hotelId,
  category,
}: { entryId: string; hotelId: string; category: string | null }) {
  const update = useUpdateEntryCategory();
  const isMarked = category === "Salários RH";
  return (
    <Button
      variant={isMarked ? "secondary" : "ghost"}
      size="sm"
      className="h-6 px-2 text-[10px]"
      disabled={update.isPending}
      onClick={async () => {
        try {
          await update.mutateAsync({
            entryId,
            hotelId,
            category: isMarked ? null : "Salários RH",
          });
          toast.success(isMarked ? "Marcação removida" : "Marcado como Salários RH");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
        }
      }}
      title={isMarked ? "Remover marcação Salários RH" : "Marcar como Salários RH"}
    >
      {isMarked ? "✓ Salários RH" : "Salários RH"}
    </Button>
  );
}

function ObservationButton({ entryId, hotelId, initial }: { entryId: string; hotelId: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const update = useUpdateEntryObservation();
  const hasObs = !!initial.trim();
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setText(initial); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 ${hasObs ? "text-accent" : "text-muted-foreground"}`}
          aria-label="Editar observação"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" align="end">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observação</p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Anotações internas…" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            size="sm"
            disabled={update.isPending || text === initial}
            onClick={async () => {
              try {
                await update.mutateAsync({ entryId, hotelId, observation: text });
                toast.success("Observação salva");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao salvar");
              }
            }}
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ApprovalBadge({ status }: { status: string }) {
  if (status === "approved")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Aprovado
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <XCircle className="h-3 w-3" /> Recusado
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
      <Clock className="h-3 w-3" /> Pendente
    </Badge>
  );
}

const STATUS_CONFIG: Record<ApPaymentStatus, { label: string; className: string; tooltip: string; Icon: typeof Banknote }> = {
  nao_aprovado_gg: {
    label: "Não aprovado pelo GG",
    className: "border-rose-500/40 text-rose-700 dark:text-rose-400",
    tooltip: "OMIE não indica aprovação do GG (a vencer, vence hoje, vencido, etc.)",
    Icon: AlertTriangle,
  },
  em_aprovacao: {
    label: "Em Aprovação",
    className: "border-amber-500/40 text-amber-700 dark:text-amber-400",
    tooltip: "GG aprovou no OMIE — aguardando autorização do financeiro",
    Icon: CircleDashed,
  },
  autorizado: {
    label: "Autorizado",
    className: "border-violet-500/40 text-violet-700 dark:text-violet-400",
    tooltip: "Autorizado para pagamento pela coordenadora",
    Icon: ShieldCheck,
  },
  agendado: {
    label: "Agendado",
    className: "border-indigo-500/40 text-indigo-700 dark:text-indigo-400",
    tooltip: "Agendado para pagamento futuro",
    Icon: CalendarClock,
  },
  pago: {
    label: "Pago",
    className: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    tooltip: "Pagamento confirmado",
    Icon: Banknote,
  },
  pago_parcialmente: {
    label: "Pago Parcialmente",
    className: "border-yellow-500/40 text-yellow-700 bg-yellow-50",
    tooltip: "Pagamento parcial registrado no OMIE",
    Icon: Banknote,
  },
};

export function PaymentStatusBadge({
  status,
  isDistribution = false,
}: {
  status: ApPaymentStatus;
  isDistribution?: boolean;
}) {
  // Distribuição de Lucros não tem fluxo de aprovação pelo GG.
  if (isDistribution && status === "em_aprovacao") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
        <Clock className="h-3 w-3" /> Pendente
      </Badge>
    );
  }
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.em_aprovacao;
  const Icon = cfg.Icon;
  const badge = (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{cfg.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
