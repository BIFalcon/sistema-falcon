import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { getLetterPdfSignedUrl } from "@/hooks/useLetter";
import { requireLetterPdfBlob } from "@/lib/letterPdfFlow";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfPath: string | null | undefined;
  versionLabel?: string;
  onDownload?: () => void;
  /** Opcional: gera o PDF na hora (layout atual) em vez de exibir o arquivo salvo. */
  buildBlob?: () => Promise<Blob | null>;
}

export function CartaPdfViewerDialog({ open, onOpenChange, pdfPath, versionLabel, onDownload, buildBlob }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pdfPath) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);
    (async () => {
      try {
        if (buildBlob) {
          const blob = await requireLetterPdfBlob(buildBlob);
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        } else {
          // Arquivo salvo somente quando não há geração atual configurada.
          const u = await getLetterPdfSignedUrl(pdfPath);
          if (cancelled) return;
          if (!u) throw new Error("Não foi possível gerar o link de visualização.");
          setUrl(u);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Não foi possível gerar a carta. Tente novamente.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pdfPath]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Carta ao Investidor{versionLabel ? ` — ${versionLabel}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-muted">
          {loading && (
            <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando PDF…
            </div>
          )}
          {error && (
            <div role="alert" className="h-full flex items-center justify-center text-destructive text-sm px-6 text-center">
              {error}
            </div>
          )}
          {url && !loading && !error && (
            <iframe src={url} title="Carta ao Investidor" className="w-full h-full border-0" />
          )}
        </div>
        <DialogFooter className="p-3 border-t">
          {onDownload && (
            <Button variant="outline" onClick={onDownload} className="gap-2">
              <FileDown className="h-4 w-4" /> Baixar PDF
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}