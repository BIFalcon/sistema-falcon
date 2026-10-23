import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import { uploadApReport, useApEntries, useLatestApUpload, type FinancialSystem } from "@/hooks/useAccountsPayable";

export function ApReportImport() {
  const { hotelId } = useModuleFilters("financeiro");
  const { isMaster, hasRole, isFernando } = useAuth();
  const canManage = !isFernando && (isMaster || hasRole("financeiro"));
  const { data: hotels = [] } = useAllHotels();
  const hotel = hotels.find(h => h.id === hotelId);
  const sourceSystem = hotel?.financial_system as FinancialSystem | null | undefined;
  const { data: entries = [] } = useApEntries(hotelId);
  const { data: last } = useLatestApUpload(hotelId);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  return <section className="space-y-3 border-t pt-4">
    <h2 className="text-lg font-semibold">Contas a Pagar — TOTVS / OMIE</h2>
    {last && <p className="text-xs text-muted-foreground">Último envio: {last.file_name}</p>}
    <input ref={ref} className="hidden" type="file" accept={sourceSystem === "totvs" ? ".xls,.xlsx" : ".xlsx,.zip"} disabled={!canManage || !hotelId || !sourceSystem || busy} onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !hotelId || !sourceSystem || !canManage) return;
      if (entries.length && !window.confirm(`Já existem ${entries.length} lançamentos para ${hotel?.name}. Atualizar os dados preservando pagamentos e aprovações?`)) return;
      setBusy(true);
      try {
        const result = await uploadApReport({ hotelId, sourceSystem, file });
        toast.success(`${result.entries} lançamento(s) importado(s)${result.skipped?.duplicate_entry ? ` · ${result.skipped.duplicate_entry} duplicado(s) ignorado(s)` : ""}`);
        window.dispatchEvent(new CustomEvent("ap:refresh"));
        qc.invalidateQueries({ queryKey: ["ap-entries", hotelId] });
        qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
        qc.invalidateQueries({ queryKey: ["ap-latest-upload", hotelId] });
      } catch (error) { toast.error(error instanceof Error ? error.message : "Erro ao importar relatório"); }
      finally { setBusy(false); }
    }} />
    <Button disabled={!canManage || !hotelId || !sourceSystem || busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Importar relatório {sourceSystem?.toUpperCase()}</Button>
    {!hotelId && <p className="text-sm text-muted-foreground">Selecione um hotel.</p>}
    {hotelId && !sourceSystem && <p role="alert" className="text-sm text-destructive">Cadastre o sistema financeiro deste hotel antes de importar.</p>}
  </section>;
}