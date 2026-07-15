import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { getDreSignedUrl } from "@/hooks/useDre";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null | undefined;
  fileName?: string;
  versionLabel?: string;
  onDownload?: () => void;
}

export function DreExcelViewerDialog({ open, onOpenChange, filePath, fileName, versionLabel, onDownload }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !filePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSignedUrl(null);
    (async () => {
      try {
        const url = await getDreSignedUrl(filePath);
        if (!url) throw new Error("Não foi possível gerar link de leitura.");
        if (cancelled) return;
        setSignedUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao abrir planilha.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filePath]);

  // Office Online Viewer renderiza o .xlsx com a formatação original
  // (cores, mesclagens, gráficos, cabeçalhos coloridos) muito mais rápido
  // do que fazer parse + sheet_to_html no navegador.
  const officeUrl = signedUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="truncate">
            DRE{versionLabel ? ` — ${versionLabel}` : ""}
            {fileName && <span className="ml-2 text-xs font-normal text-muted-foreground">{fileName}</span>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Visualização fiel da planilha via Office Online. Se demorar a
            carregar, use "Baixar planilha" para abrir localmente no Excel.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparando planilha…
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-destructive text-sm px-6 text-center">
              {error}
            </div>
          )}
          {!loading && !error && officeUrl && (
            <iframe
              key={officeUrl}
              src={officeUrl}
              title="Visualizador DRE"
              className="flex-1 min-h-0 w-full border-0 bg-white"
              allow="fullscreen"
            />
          )}
        </div>

        <DialogFooter className="p-3 border-t">
          {onDownload && (
            <Button variant="outline" onClick={onDownload} className="gap-2">
              <Download className="h-4 w-4" /> Baixar planilha
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}