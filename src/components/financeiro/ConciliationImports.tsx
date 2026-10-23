import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { fmtDateTime } from "@/lib/formatters";
import { useImportOpera, useImportAcquirer, useImportB2B, useImportBankStatement, useConcUploads, useMatchedCountsByUpload, useDeleteConcUpload, useAutoReconcile } from "@/hooks/useConciliacaoCartao";
import { RedeReceiptsImporter } from "@/components/conciliacao/RedeRecebimentosTabs";
import { B2BReceiptsImporter } from "@/components/conciliacao/B2BBaixaTab";
import { FrancesinhaImporter } from "@/components/conciliacao/FrancesinhaTab";
function DropZone({ label, hint, accept, onFile, busy }: {
  label: string; hint: string; accept: Record<string, string[]>;
  onFile: (f: File) => void; busy: boolean;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept, maxFiles: 1, disabled: busy,
    onDrop: (files) => files[0] && onFile(files[0]),
  });
  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
        isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
      } ${busy ? "opacity-60 pointer-events-none" : ""}`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6 opacity-40" />}
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px]">{hint}</p>
      </div>
    </div>
  );
}

export function ConciliationImports() {
 const { allowedHotels } = useAuth();
 const { hotelId } = useModuleFilters("financeiro");
 const hotelName = allowedHotels.find(h => h.id === hotelId)?.name ?? "";
 const importOpera = useImportOpera();
 const importAcquirer = useImportAcquirer();
 const importB2B = useImportB2B();
 const importBank = useImportBankStatement();
 const uploads = useConcUploads(hotelId);
 const matchedByUpload = useMatchedCountsByUpload((uploads.data ?? []).map(u => u.id as string), true);
 const deleteUpload = useDeleteConcUpload();
 const autoReconcile = useAutoReconcile();
  const uploadHotelLabel = (u: Record<string, unknown>): string => {
    const direct = allowedHotels.find((h) => h.id === u.hotel_id)?.name;
    if (direct) return direct;
    const meta = (u.metadata ?? {}) as { hotel_ids?: string[] };
    const names = (meta.hotel_ids ?? [])
      .map((id) => allowedHotels.find((h) => h.id === id)?.name)
      .filter(Boolean) as string[];
    if (names.length === 0) return "—";
    return names.length <= 2 ? names.join(", ") : `${names.length} hotéis`;
  };

return <div className="space-y-4">          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Opera (XML) ou TOTVS (Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar XML do Opera ou Excel TOTVS"
                  hint={hotelId ? `Hotel: ${hotelName}` : "Selecione o hotel no filtro do topo antes de importar"}
                  accept={{ "application/xml": [".xml"], "text/xml": [".xml"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importOpera.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar o XML do Opera."); return; }
                    importOpera.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(
                        `${r.inserted} transação(ões) importada(s) · ${r.skipped} fora do mapeamento` +
                        ("skippedCodes" in r && r.skippedCodes?.length ? ` (códigos: ${r.skippedCodes.join(", ")})` : "") +
                        ` · ${r.duplicates} já existente(s)` +
                        ` · ${r.autoMatched} conciliada(s) automaticamente` +
                        ("unclassified" in r && r.unclassified?.length ? ` · sem categoria: ${r.unclassified.join(", ")}` : ""),
                      ),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Operadora (Rede — Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar Excel da operadora"
                  hint={hotelId ? `Filtra pelo CNPJ de ${hotelName}` : "Selecione o hotel no filtro do topo antes de importar"}
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importAcquirer.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar a planilha da operadora."); return; }
                    importAcquirer.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(
                        `${r.inserted} venda(s) importada(s) · ${r.otherHotels} de outros CNPJs descartada(s)` +
                        ` · ${r.duplicates} já existente(s) · ${r.autoMatched} conciliada(s) automaticamente`,
                      ),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Relatório B2B (Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar Excel do B2B"
                  hint={hotelId ? `Lançado em ${hotelName} · só status "Sucesso"` : "Selecione o hotel no filtro do topo antes de importar"}
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importB2B.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar o relatório B2B."); return; }
                    importB2B.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(
                        `${r.inserted} venda(s) B2B importada(s) · ${r.skipped} sem status "Sucesso" descartada(s)` +
                        ` · ${r.duplicates} já existente(s) · ${r.autoMatched} conciliada(s) automaticamente`,
                      ),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Extrato Bancário (Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar extrato bancário"
                  hint='Aba "Lançamentos" — hotel identificado pelo Nome da conta'
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importBank.isPending}
                  onFile={(f) => importBank.mutate({ file: f, hotelIdOverride: hotelId }, {
                    onSuccess: (r) => toast.success(
                      `${r.inserted} lançamento(s) importado(s) — ${r.accountName || r.hotelId}` +
                      ` · ${r.duplicates} já existente(s) · ${r.autoMatched} conciliada(s) automaticamente`,
                    ),
                    onError: (e: Error) => toast.error(e.message),
                  })}
                />
              </CardContent>
            </Card>
          </div>

          {hotelId && <div className="grid gap-4 md:grid-cols-3"><section><h3 className="mb-2 font-medium text-sm">Recebimentos Rede</h3><RedeReceiptsImporter hotelId={hotelId} /></section><section><h3 className="mb-2 font-medium text-sm">Transferência B2B Checkout</h3><B2BReceiptsImporter hotelId={hotelId} /></section><section><h3 className="mb-2 font-medium text-sm">Francesinha</h3><FrancesinhaImporter hotelId={hotelId} /></section></div>}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Últimas importações</CardTitle></CardHeader>
            <CardContent className="pb-3 pt-0">
              <Button
                size="sm"
                variant="outline"
                disabled={autoReconcile.isPending}
                onClick={() => autoReconcile.mutate(hotelId, {
                  onSuccess: (n) => toast.success(n ? `${n} par(es) conciliado(s) automaticamente` : "Nenhum par exato pendente"),
                  onError: (e: Error) => toast.error(e.message),
                })}
              >
                Rodar conciliação automática
              </Button>
            </CardContent>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Hotel</TableHead>
                    <TableHead className="text-right">Importados</TableHead>
                    <TableHead className="text-right">Descartados</TableHead>
                    <TableHead className="text-right">Conciliados</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(uploads.data ?? []).map((u) => (
                    <TableRow key={u.id as string} className="text-[11px]">
                      <TableCell>{fmtDateTime(u.uploaded_at as string)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{String(u.kind)}</Badge></TableCell>
                      <TableCell className="max-w-[280px] truncate">{String(u.file_name)}</TableCell>
                      <TableCell>{uploadHotelLabel(u)}</TableCell>
                      <TableCell className="text-right">{Number(u.parsed_count ?? 0)}</TableCell>
                      <TableCell className="text-right">{Number(u.skipped_count ?? 0)}</TableCell>
                      <TableCell className="text-right">
                        {matchedByUpload.data?.get(u.id as string) ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 text-[11px] text-destructive hover:text-destructive"
                          disabled={deleteUpload.isPending}
                          onClick={() => {
                            if (!window.confirm(`Excluir a importação "${String(u.file_name)}" e todos os lançamentos dela?`)) return;
                            deleteUpload.mutate(
                              { id: u.id as string, kind: String(u.kind) },
                              {
                                onSuccess: () => toast.success("Importação excluída."),
                                onError: (e) => toast.error((e as Error).message),
                              },
                            );
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Excluir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(uploads.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">
                      Nenhuma importação ainda.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
</div>;
}
