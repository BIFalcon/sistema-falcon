import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useUploadArReport, useDeleteArUpload } from "@/hooks/useAccountsReceivable";
export function ArReportImport({
  kind,
  lastUpload,
  isManager,
}: {
  kind: "to_invoice" | "open_folio";
  lastUpload: { uploaded_at: string; file_name: string; parsed_rows_count: number | null; unmapped_properties: unknown } | null | undefined;
  isManager: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const upload = useUploadArReport();
  const deleteUpload = useDeleteArUpload();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const res = await upload.mutateAsync({ file: f, kind });
      const unmapped = (res?.unmapped_properties ?? []) as string[];
      let undone = false;
      const skippedExisting = (res as any).skipped_existing ?? 0;
      const skippedDupFile = (res as any).skipped_duplicate_in_file ?? 0;
      const totalRows = (res as any).total_rows ?? res.entries;
      const partsExtra: string[] = [];
      if (kind === "to_invoice") {
        partsExtra.push(`${res.entries} nova(s)`);
        if (skippedExisting) partsExtra.push(`${skippedExisting} já existia(m)`);
        if (skippedDupFile) partsExtra.push(`${skippedDupFile} duplicada(s) no arquivo`);
      }
      const baseMsg =
        kind === "to_invoice"
          ? `${totalRows} linha(s) lidas · ${partsExtra.join(" · ")}`
          : `${res.entries} linha(s) processadas`;
      if (unmapped.length) {
        toast.warning(`${baseMsg}. ${unmapped.length} hotel(éis) não mapeado(s) — configure em Hotéis.`, {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              undone = true;
              try {
                await deleteUpload.mutateAsync({ uploadId: res.upload_id, kind });
                toast.success("Upload revertido.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao reverter");
              }
            },
          },
        });
      } else {
        toast.success(baseMsg, {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              undone = true;
              try {
                await deleteUpload.mutateAsync({ uploadId: res.upload_id, kind });
                toast.success("Upload revertido.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao reverter");
              }
            },
          },
        });
      }
      // Notificação automática ao GG (somente se não desfeito após 8s)
      setTimeout(async () => {
        if (undone) return;
        const fn = kind === "to_invoice" ? "notify-gg-to-invoice" : "notify-gg-open-folio";
        try {
          await supabase.functions.invoke(fn, { body: { upload_id: res.upload_id } });
        } catch (err) {
          // silencioso: notificação automática é best-effort
          console.warn(`[${fn}] falha:`, err);
        }
      }, 8500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const unmapped = (lastUpload?.unmapped_properties as string[] | undefined) ?? [];

  return (
    <Card className="p-4 shadow-soft">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent" />
            {kind === "to_invoice" ? "Importar relatório Faturamento" : "Importar relatório Open Folio"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {kind === "to_invoice"
              ? "Acumulativo. Cada upload soma ao histórico (linhas duplicadas são ignoradas)."
              : "Substitui completamente o anterior. Os GGs serão notificados automaticamente."}
          </p>
          {lastUpload && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Último upload: <strong>{format(new Date(lastUpload.uploaded_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</strong> ·{" "}
              {lastUpload.file_name} · {lastUpload.parsed_rows_count ?? 0} linhas
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onFile}
          disabled={!isManager || uploading}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={!isManager || uploading} className="gap-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar Relatório
        </Button>
      </div>
      {!isManager && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Apenas usuários <strong>Patronos</strong> ou <strong>Master</strong> podem fazer upload.
        </p>
      )}
      {unmapped.length > 0 && (
        <div className="mt-3 p-2 rounded border border-amber-500/30 bg-amber-500/10 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>{unmapped.length} hotel(éis) não mapeado(s)</strong> no último upload:{" "}
            {unmapped.slice(0, 5).map((u, i) => (
              <Badge key={i} variant="outline" className="ml-1 text-[10px]">{u}</Badge>
            ))}
            {unmapped.length > 5 && <span className="ml-1">+{unmapped.length - 5}</span>}
            <p className="mt-1 text-muted-foreground">
              Configure o "Nome no Opera Cloud" em <strong>Configurações → Hotéis</strong>.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

