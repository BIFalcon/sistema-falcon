import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { getDreSignedUrl } from "@/hooks/useDre";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null | undefined;
  fileName?: string;
  versionLabel?: string;
  onDownload?: () => void;
}

interface SheetHtml {
  name: string;
  html: string;
}

const SIZE_WARN_BYTES = 10 * 1024 * 1024;

export function DreExcelViewerDialog({ open, onOpenChange, filePath, fileName, versionLabel, onDownload }: Props) {
  const [sheets, setSheets] = useState<SheetHtml[]>([]);
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnLarge, setWarnLarge] = useState(false);

  useEffect(() => {
    if (!open || !filePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSheets([]);
    setWarnLarge(false);

    (async () => {
      try {
        const url = await getDreSignedUrl(filePath);
        if (!url) throw new Error("Não foi possível gerar link de leitura.");
        const res = await fetch(url);
        if (!res.ok) throw new Error("Falha ao baixar arquivo.");
        const blob = await res.blob();
        if (blob.size >= SIZE_WARN_BYTES) setWarnLarge(true);
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, {
          type: "array",
          cellStyles: true,
          cellHTML: true,
        });
        const out: SheetHtml[] = wb.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], {
            editable: false,
            id: `sheet-${name.replace(/\s+/g, "-")}`,
          }),
        }));
        if (cancelled) return;
        setSheets(out);
        setActive(out[0]?.name ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao abrir planilha.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, filePath]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="truncate">
            DRE{versionLabel ? ` — ${versionLabel}` : ""}
            {fileName && <span className="ml-2 text-xs font-normal text-muted-foreground">{fileName}</span>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Visualização de dados e formatação. Imagens e gráficos do arquivo original não são exibidos neste modo.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {warnLarge ? "Arquivo grande, renderizando…" : "Carregando planilha…"}
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-destructive text-sm px-6 text-center">
              {error}
            </div>
          )}
          {!loading && !error && sheets.length > 0 && (
            <Tabs value={active} onValueChange={setActive} className="flex-1 min-h-0 flex flex-col">
              <div className="px-4 pt-3 border-b overflow-x-auto">
                <TabsList>
                  {sheets.map((s) => (
                    <TabsTrigger key={s.name} value={s.name} className="text-xs">
                      {s.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {sheets.map((s) => (
                <TabsContent
                  key={s.name}
                  value={s.name}
                  className="flex-1 min-h-0 m-0 overflow-auto p-4 dre-excel-viewer"
                >
                  <div dangerouslySetInnerHTML={{ __html: s.html }} />
                </TabsContent>
              ))}
            </Tabs>
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