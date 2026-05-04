/**
 * Modal para vincular / desvincular documentos a um lançamento.
 * Extraído de ContasPagarPage — sem mudança de comportamento.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Paperclip,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ApDocument, ApEntry } from "@/hooks/useAccountsPayable";
import { getDocumentSignedUrl } from "@/hooks/useAccountsPayable";
import { fmtBRL, fmtDate } from "@/lib/formatters";

interface LinkDocDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ApEntry | null;
  documents: ApDocument[];
  currentDoc: ApDocument | null;
  unlinkedDocs: ApDocument[];
  onLink: (docId: string | null, nfAmount: number | null) => Promise<void> | void;
  onDelete: (d: ApDocument) => Promise<void> | void;
}

export function LinkDocDialog({
  open,
  onClose,
  entry,
  documents: _documents,
  currentDoc,
  unlinkedDocs,
  onLink,
  onDelete,
}: LinkDocDialogProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [nfAmountInput, setNfAmountInput] = useState<string>("");

  // Reseta os campos sempre que o lançamento alvo muda
  const entryId = entry?.id ?? null;
  useMemo(() => {
    setSelectedId(currentDoc?.id ?? "");
    setNfAmountInput(currentDoc?.nf_amount != null ? String(currentDoc.nf_amount) : "");
  }, [entryId, currentDoc?.id]);

  if (!entry) return null;

  const choices = currentDoc ? [currentDoc, ...unlinkedDocs] : unlinkedDocs;

  const nfFloat = nfAmountInput ? parseFloat(nfAmountInput) : null;
  const hasDivergence =
    nfFloat !== null && Math.abs(nfFloat - Number(entry.amount)) > 0.01;

  async function openDoc(d: ApDocument) {
    const url = await getDocumentSignedUrl(d.file_path);
    if (url) window.open(url, "_blank");
    else toast.error("Não foi possível abrir o arquivo");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular documento ao lançamento</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Resumo do lançamento */}
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p className="font-semibold">{entry.supplier}</p>
            <p className="text-xs text-muted-foreground">
              Doc {entry.document_number ?? "—"} · Venc. {fmtDate(entry.due_date)} ·{" "}
              {fmtBRL(Number(entry.amount))}
            </p>
          </div>

          {/* Resultado da validação IA */}
          {currentDoc?.validation_status && (
            <ValidationResult doc={currentDoc} />
          )}

          {/* Lista de documentos disponíveis */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Documento ({choices.length} disponível{choices.length === 1 ? "" : "is"})
            </label>
            {choices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md">
                Nenhum documento disponível. Use "Importar Documentos" no topo da página.
              </p>
            ) : (
              <div className="border rounded-md max-h-[260px] overflow-y-auto divide-y">
                {choices.map((d) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50 ${
                      selectedId === d.id ? "bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <input
                      type="radio"
                      readOnly
                      checked={selectedId === d.id}
                      onChange={() => setSelectedId(d.id)}
                    />
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{d.file_name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={(e) => { e.stopPropagation(); openDoc(d); }}
                      title="Abrir"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(d); }}
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Valor da NF */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Valor da NF (opcional — para detectar divergência)
            </label>
            <Input
              type="number"
              step="0.01"
              placeholder={String(entry.amount)}
              value={nfAmountInput}
              onChange={(e) => setNfAmountInput(e.target.value)}
            />
            {hasDivergence && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Diferença de {fmtBRL(nfFloat! - Number(entry.amount))} em relação ao lançamento.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          {currentDoc && (
            <Button
              variant="ghost"
              onClick={() => onLink(null, null)}
              className="mr-auto"
            >
              Remover vínculo
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!selectedId}
            onClick={() => onLink(selectedId, nfFloat)}
          >
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Resultado de validação IA ───────────────────────────────────────────────

function ValidationResult({ doc }: { doc: ApDocument }) {
  const s = doc.validation_status;
  const borderClass =
    s === "ok"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : s === "divergence"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-border bg-muted/30";

  return (
    <div className={`rounded-md border p-3 text-xs space-y-1 ${borderClass}`}>
      <div className="flex items-center gap-2 font-semibold">
        {s === "ok" ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Validado pela IA
          </>
        ) : s === "divergence" ? (
          <>
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Divergência detectada
          </>
        ) : (
          <>
            <Clock className="h-4 w-4" /> Validação: {s}
          </>
        )}
      </div>
      {doc.doc_type && (
        <p>
          Tipo: <span className="font-mono">{doc.doc_type}</span>
        </p>
      )}
      {doc.doc_cnpj && (
        <p>
          CNPJ no documento: <span className="font-mono">{doc.doc_cnpj}</span>
        </p>
      )}
      {doc.nf_amount != null && (
        <p>
          Valor NF: <span className="font-mono">{fmtBRL(Number(doc.nf_amount))}</span>
        </p>
      )}
      {doc.validation_details?.summary && (
        <p className="text-muted-foreground italic">
          {String(doc.validation_details.summary)}
        </p>
      )}
    </div>
  );
}
