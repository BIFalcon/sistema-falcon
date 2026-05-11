/**
 * Linha da tabela de lançamentos de Contas a Pagar.
 */
import { AlertTriangle, Banknote, CalendarClock, CheckCircle2, CircleDashed, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ApEntry, ApPaymentStatus, FinancialSystem } from "@/hooks/useAccountsPayable";
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
}: EntryRowProps) {
  const overdue = entry.omie_situation?.toLowerCase().includes("atras");
  const archived = !!entry.archived_at;

  const paymentRowClass =
    entry.payment_status === "pago"
      ? "bg-emerald-500/10 dark:bg-emerald-500/10"
      : entry.payment_status === "inserido"
      ? "bg-sky-500/10 dark:bg-sky-500/10"
      : entry.payment_status === "agendado"
      ? "bg-violet-500/10 dark:bg-violet-500/10"
      : "";

  return (
    <TableRow
      className={`${paymentRowClass} ${!paymentRowClass && overdue ? "bg-destructive/5" : ""} ${archived ? "opacity-60" : ""}`}
    >
      {selectable && (
        <TableCell className="w-8">
          <Checkbox
            checked={selected}
            onCheckedChange={(c) => onToggleSelected?.(!!c)}
            aria-label="Selecionar lançamento"
          />
        </TableCell>
      )}
      {/* Fornecedor */}
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span>{entry.supplier}</span>
          {archived && (
            <Badge variant="outline" className="text-[10px]">
              Arquivado
            </Badge>
          )}
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
        <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{entry.cnpj ?? "—"}</TableCell>
      )}

      {/* Nº Doc — não-compact */}
      {!compact && (
        <TableCell className="text-xs hidden md:table-cell">{entry.document_number ?? "—"}</TableCell>
      )}

      {/* Vencimento */}
      <TableCell className="text-xs">{fmtDate(entry.due_date)}</TableCell>

      {/* Valor */}
      <TableCell className="text-right font-mono text-sm">
        <div>{fmtBRL(Number(entry.amount))}</div>
      </TableCell>

      {/* Categoria — não-compact */}
      {!compact && (
        <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
          {entry.category ?? entry.payment_method ?? "—"}
        </TableCell>
      )}

      {/* Aprovação GG */}
      {showApproval && (
        <TableCell>
          <ApprovalBadge status={entry.gg_approval} />
        </TableCell>
      )}

      {/* Status de pagamento */}
      {!compact && (
        <TableCell>
          <PaymentStatusBadge status={entry.payment_status} />
        </TableCell>
      )}
    </TableRow>
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
  em_aprovacao: {
    label: "Em Aprovação",
    className: "border-amber-500/40 text-amber-700 dark:text-amber-400",
    tooltip: "Aprovado pelo GG — aguardando autorização do financeiro",
    Icon: CircleDashed,
  },
  autorizado: {
    label: "Autorizado",
    className: "border-violet-500/40 text-violet-700 dark:text-violet-400",
    tooltip: "Autorizado para pagamento pela coordenadora",
    Icon: ShieldCheck,
  },
  inserido: {
    label: "Inserido",
    className: "border-sky-500/40 text-sky-700 dark:text-sky-400",
    tooltip: "Inserido no banco — aguardando compensação",
    Icon: CheckCircle2,
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
};

export function PaymentStatusBadge({ status }: { status: ApPaymentStatus }) {
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
