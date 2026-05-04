/**
 * Linha da tabela de lançamentos de Contas a Pagar.
 * Extraída de ContasPagarPage para isolar a renderização por linha.
 */
import { AlertTriangle, CheckCircle2, Clock, Link2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ApDocument, ApEntry, FinancialSystem } from "@/hooks/useAccountsPayable";
import { fmtBRL, fmtDate } from "@/lib/formatters";

interface EntryRowProps {
  entry: ApEntry;
  doc: ApDocument | null;
  sourceSystem: FinancialSystem | null;
  canApprove: boolean;
  canManage: boolean;
  showApproval?: boolean;
  compact?: boolean;
  onLink: () => void;
  onApprove: (a: "approved" | "rejected" | "pending") => void;
}

export function EntryRow({
  entry,
  doc,
  sourceSystem,
  canApprove,
  canManage,
  showApproval = true,
  compact = false,
  onLink,
  onApprove,
}: EntryRowProps) {
  const overdue = entry.omie_situation?.toLowerCase().includes("atras");
  const archived = !!entry.archived_at;

  const amountDivergent =
    doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(entry.amount)) > 0.01;
  const divergent = doc?.validation_status === "divergence" || amountDivergent;

  return (
    <TableRow className={`${overdue ? "bg-destructive/5" : ""} ${archived ? "opacity-60" : ""}`}>
      {/* Fornecedor */}
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span>{entry.supplier}</span>
          {archived && (
            <Badge variant="outline" className="text-[10px]">
              Arquivado
            </Badge>
          )}
          {divergent && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" /> Divergência
            </Badge>
          )}
        </div>
      </TableCell>

      {/* CNPJ — só OMIE e não-compact */}
      {!compact && sourceSystem === "omie" && (
        <TableCell className="text-xs text-muted-foreground">{entry.cnpj ?? "—"}</TableCell>
      )}

      {/* Nº Doc — não-compact */}
      {!compact && (
        <TableCell className="text-xs">{entry.document_number ?? "—"}</TableCell>
      )}

      {/* Vencimento */}
      <TableCell className="text-xs">{fmtDate(entry.due_date)}</TableCell>

      {/* Valor */}
      <TableCell className="text-right font-mono text-sm">
        <div>{fmtBRL(Number(entry.amount))}</div>
        {amountDivergent && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">
            NF: {fmtBRL(Number(doc!.nf_amount))}
          </div>
        )}
      </TableCell>

      {/* Forma/Categoria — não-compact */}
      {!compact && (
        <TableCell className="text-xs text-muted-foreground">
          {entry.payment_method ?? entry.category ?? "—"}
        </TableCell>
      )}

      {/* Aprovação GG */}
      {showApproval && (
        <TableCell>
          <ApprovalBadge status={entry.gg_approval} />
        </TableCell>
      )}

      {/* Documento vinculado */}
      <TableCell>
        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={onLink}
            title={doc ? doc.file_name : "Vincular documento"}
          >
            {doc ? (
              <>
                <CheckCircle2
                  className={`h-3.5 w-3.5 ${divergent ? "text-amber-600" : "text-emerald-600"}`}
                />
                <span className="truncate max-w-[100px]">{doc.file_name}</span>
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                Vincular
              </>
            )}
          </Button>
        ) : doc ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Ações */}
      <TableCell className="text-right">
        {canApprove && entry.gg_approval !== "approved" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onApprove("approved")}
          >
            Aprovar
          </Button>
        )}
        {canApprove && entry.gg_approval !== "rejected" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive"
            onClick={() => onApprove("rejected")}
          >
            Recusar
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Badge de aprovação ──────────────────────────────────────────────────────

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
