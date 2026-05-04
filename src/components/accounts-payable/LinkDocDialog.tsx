/**
 * Modal para vincular / desvincular documentos a um lançamento.
 * Suporta múltiplos documentos por lançamento (ex.: NF + boleto)
 * e busca por nome de arquivo na lista de documentos disponíveis.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Paperclip,
  Search,
  Star,
  Trash2,
  X,
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
  /** Documentos atualmente vinculados a este lançamento. */
  linkedDocs: ApDocument[];
  /** Documento marcado como principal (primary_document_id). */
  primaryDoc: ApDocument | null;
  /** Documentos sem vínculo, disponíveis para anexar. */
  unlinkedDocs: ApDocument[];
  onAttach: (docId: string, nfAmount: number | null) => Promise<void> | void;
  onDetach: (d: ApDocument) => Promise<void> | void;
  onSetPrimary: (d: ApDocument) => Promise<void> | void;
  onDelete: (d: ApDocument) => Promise<void> | void;
}

export function LinkDocDialog({
  open,
  onClose,
  entry,
  linkedDocs,
  primaryDoc,
  unlinkedDocs,
  onAttach,
  onDetach,
  onSetPrimary,
  onDelete,
}: LinkDocDialogProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [nfAmountInput, setNfAmountInput] = useState<string>("");
  const [search, setSearch] = useState("");

  // Reseta sempre que o lançamento alvo muda
  const entryId = entry?.id ?? null;
  useEffect(() => {
    setSelectedId("");
    setNfAmountInput("");
    setSearch("");
  }, [entryId]);

  const filteredUnlinked = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unlinkedDocs;
    return unlinkedDocs.filter((d) => d.file_name.toLowerCase().includes(q));
  }, [unlinkedDocs, search]);

  if (!entry) return null;

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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Documentos do lançamento</DialogTitle>
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

          {/* Validação IA do documento principal */}
          {primaryDoc?.validation_status && <ValidationResult doc={primaryDoc} />}

          {/* Documentos já vinculados */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Vinculados ({linkedDocs.length})
            </label>
            {linkedDocs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md">
                Nenhum documento vinculado ainda.
              </p>
            ) : (
              <div className="border rounded-md divide-y">
                {linkedDocs.map((d) => {
                  const isPrimary = primaryDoc?.id === d.id;
                  return (
                    <div key={d.id} className="flex items-center gap-2 p-2 text-sm">
                      {isPrimary ? (
                        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate">
                        {d.file_name}
                        {isPrimary && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Principal
                          </Badge>
                        )}
                      </span>
                      {!isPrimary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => onSetPrimary(d)}
                          title="Marcar como principal"
                        >
                          Principal
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => openDoc(d)}
                        title="Abrir"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-amber-700"
                        onClick={() => onDetach(d)}
                        title="Desvincular (mantém o arquivo)"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-destructive"
                        onClick={() => onDelete(d)}
                        title="Excluir arquivo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Adicionar novo documento */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Adicionar documento ({unlinkedDocs.length} não vinculado{unlinkedDocs.length === 1 ? "" : "s"})
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pelo nome do arquivo…"
                className="pl-8 h-9"
              />
            </div>
            {filteredUnlinked.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md">
                {unlinkedDocs.length === 0
                  ? 'Nenhum documento disponível. Use "Importar Documentos" no topo da página.'
                  : "Nenhum arquivo corresponde à busca."}
              </p>
            ) : (
              <div className="border rounded-md max-h-[220px] overflow-y-auto divide-y">
                {filteredUnlinked.map((d) => (
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
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={!selectedId}
            onClick={async () => {
              await onAttach(selectedId, nfFloat);
              setSelectedId("");
              setNfAmountInput("");
              setSearch("");
            }}
          >
            Vincular selecionado
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
