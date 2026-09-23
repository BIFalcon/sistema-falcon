import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useNfConference } from "@/hooks/useNfConference";
import {
  useNfScopeCounts,
  useNfScopeData,
  useNfUploads,
  useUploadNfFiles,
} from "@/hooks/useNfConferenceData";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { fmtBRL } from "@/lib/formatters";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const PAGE_SIZE = 50;

function DropZone({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (f: File) => void;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    onDrop: (files) => files[0] && onFile(files[0]),
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
        ${isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}
        ${file ? "border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-900/10" : ""}`}
    >
      <input {...getInputProps()} />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-medium">{file.name}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Upload className="h-8 w-8 opacity-40" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs">Arraste ou clique para selecionar</p>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  colorClass,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  colorClass: string;
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;

  return (
    <Card className="overflow-hidden shadow-soft">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className={`font-semibold text-sm ${colorClass}`}>{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{count} registro(s)</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      {expanded && <div className="border-t p-4">{children}</div>}
    </Card>
  );
}

/** Lista paginada de verdade (mostra em blocos, não o acervo inteiro). */
function Paged<T>({
  rows,
  children,
}: {
  rows: T[];
  children: (visible: T[]) => React.ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  return (
    <div className="space-y-3">
      {children(rows.slice(0, limit))}
      {rows.length > limit && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
        >
          Mostrar mais ({rows.length - limit} restantes)
        </Button>
      )}
    </div>
  );
}

export default function ConferenciaNotasFiscaisPage() {
  const { allowedHotels } = useAuth();
  const { hotelId, month, year, setHotelId, setMonth, setYear } = useModuleFilters("global");
  const [operaFile, setOperaFile] = useState<File | null>(null);
  const [prefeituraFile, setPrefeituraFile] = useState<File | null>(null);

  const upload = useUploadNfFiles();
  const { data: counts } = useNfScopeCounts(hotelId, year, month);
  const { data: scopeData, isLoading } = useNfScopeData(hotelId, year, month);
  const { data: uploads = [] } = useNfUploads(hotelId, year, month);

  const reservations = scopeData?.reservations ?? [];
  const notas = scopeData?.notas ?? [];
  const result = useNfConference(reservations, notas);

  const hotelName = useMemo(
    () => allowedHotels.find((h) => h.id === hotelId)?.name ?? null,
    [allowedHotels, hotelId],
  );

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y + 1, y, y - 1, y - 2];
  }, []);

  const handleProcess = async () => {
    // Escopo capturado no instante do clique — nunca de estado antigo.
    const scope = { hotelId: hotelId ?? "", refYear: year, refMonth: month };
    if (!scope.hotelId) {
      toast.error("Selecione um hotel antes de enviar os arquivos");
      return;
    }
    if (!operaFile || !prefeituraFile) {
      toast.error("Selecione os dois arquivos (Opera R&A e Prefeitura)");
      return;
    }
    try {
      const res = await upload.mutateAsync({ scope, operaFile, prefeituraFile });
      toast.success(
        `${hotelName ?? scope.hotelId} · ${MONTHS[month - 1]}/${year}: ` +
          `${res.operaInserted} de ${res.operaTotal} linhas do Opera e ` +
          `${res.notaInserted} de ${res.notaTotal} notas gravadas (repetidas ignoradas)`,
      );
      setOperaFile(null);
      setPrefeituraFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar arquivos");
    }
  };

  const handleExport = () => {
    if (!result) return;
    const rows: unknown[][] = [
      ["Status", "Confirmação", "RPS", "Nota", "Hóspede (Opera)", "Check-in", "Check-out", "Valor (R$)", "Motivo"],
    ];
    const statusLabel: Record<string, string> = {
      conciliado: "Conciliado",
      divergencia: "Divergência",
      sem_nota: "Sem nota emitida",
      sem_reserva_opera: "Sem reserva no Opera",
    };
    for (const item of [
      ...result.conciliados,
      ...result.divergencias,
      ...result.semNota,
      ...result.semReservaOpera,
    ]) {
      const rps = item.reservation?.lines.map((l) => l.fiscalBillNumber).filter(Boolean).join(", ") ?? "";
      const nfs = item.notas.map((n) => n.numeroNfse).join(", ");
      const rpsFromNotas = item.notas.map((n) => n.rps).filter(Boolean).join(", ");
      const valor = item.reservation?.totalNet
        ?? item.notas.reduce((s, n) => s + n.valorServico, 0);
      rows.push([
        statusLabel[item.status] ?? item.status,
        item.reservation?.confirmationNumber ?? "—",
        rps || rpsFromNotas || "—",
        nfs || "—",
        item.reservation?.guestName ?? "—",
        item.reservation?.arrival ?? "—",
        item.reservation?.departure ?? "—",
        valor,
        item.motivos.join(" | ") || (item.status === "conciliado" ? "OK" : ""),
      ]);
    }
    if (rows.length === 1) return;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conferência NF");
    XLSX.writeFile(
      wb,
      `conferencia-notas-fiscais-${hotelId ?? "hotel"}-${year}-${String(month).padStart(2, "0")}.xlsx`,
    );
  };

  const hasData = (counts?.operaRows ?? 0) > 0 || (counts?.notaRows ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Controladoria
        </p>
        <h1 className="text-2xl font-semibold">Conferência de Notas Fiscais</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cruza as hospedagens do Oracle R&A com as notas fiscais emitidas na prefeitura para
          identificar reservas sem nota.
        </p>
      </div>

      <Card className="p-4 shadow-soft">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hotel
            </p>
            <Select value={hotelId ?? ""} onValueChange={(v) => setHotelId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o hotel" />
              </SelectTrigger>
              <SelectContent>
                {allowedHotels.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mês de referência
            </p>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ano
            </p>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Os arquivos enviados ficam gravados para{" "}
          <strong>{hotelName ?? "o hotel selecionado"}</strong> em{" "}
          <strong>{MONTHS[month - 1]} de {year}</strong>. Reenviar o relatório do mês (MTD) apenas
          acrescenta as linhas novas — nada duplica.
          {counts && (
            <>
              {" "}Hoje há {counts.operaRows} linha(s) do Opera e {counts.notaRows} nota(s) gravadas
              neste período.
            </>
          )}
        </p>
      </Card>

      <Card className="p-6 shadow-soft space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hospedagens — Oracle R&A (obrigatório)
            </p>
            <DropZone
              label="Relatório de hospedagens (.xlsx)"
              file={operaFile}
              onFile={setOperaFile}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notas Fiscais — Prefeitura (obrigatório)
            </p>
            <DropZone
              label="Relatório de NFS-e emitidas (.xlsx)"
              file={prefeituraFile}
              onFile={setPrefeituraFile}
            />
          </div>
        </div>
        <Button
          onClick={handleProcess}
          disabled={!hotelId || !operaFile || !prefeituraFile || upload.isPending}
          className="w-full"
        >
          {upload.isPending ? "Processando..." : "Enviar e analisar conferência"}
        </Button>
        {uploads.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Último envio: {new Date(uploads[0].created_at).toLocaleString("pt-BR")} ·{" "}
            {uploads[0].file_name}
          </p>
        )}
      </Card>

      {!hotelId ? (
        <Card className="p-6 shadow-soft text-sm text-muted-foreground">
          Selecione um hotel para ver a conferência.
        </Card>
      ) : isLoading ? (
        <Card className="p-6 shadow-soft text-sm text-muted-foreground">Carregando…</Card>
      ) : !hasData ? (
        <Card className="p-6 shadow-soft text-sm text-muted-foreground">
          Nenhum arquivo enviado para {hotelName} em {MONTHS[month - 1]} de {year}.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 shadow-soft">
              <p className="text-xs text-muted-foreground">Conciliadas</p>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {result?.conciliados.length ?? 0}
              </p>
              <p className="text-xs font-medium">{fmtBRL(result?.totals.conciliadosTotal ?? 0)}</p>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-xs text-muted-foreground">Divergências</p>
              <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                {result?.divergencias.length ?? 0}
              </p>
              <p className="text-xs font-medium">{fmtBRL(result?.totals.divergenciasTotal ?? 0)}</p>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-xs text-muted-foreground">Sem nota emitida</p>
              <p className="text-lg font-semibold text-destructive">
                {result?.semNota.length ?? 0}
              </p>
              <p className="text-xs font-medium">{fmtBRL(result?.totals.semNotaTotal ?? 0)}</p>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-xs text-muted-foreground">Notas sem reserva</p>
              <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                {result?.semReservaOpera.length ?? 0}
              </p>
              <p className="text-xs font-medium">{fmtBRL(result?.totals.semReservaTotal ?? 0)}</p>
            </Card>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {result && (result.semNota.length > 0 || result.divergencias.length > 0) ? (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-5 w-5" />
                  <span className="font-semibold">
                    {result.semNota.length} sem nota · {result.divergencias.length} divergência(s)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Todas as reservas emitiram nota</span>
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
          </div>

          <div className="space-y-3">
            <SectionCard
              title="Sem nota emitida"
              icon={<XCircle className="h-5 w-5 text-destructive shrink-0" />}
              colorClass="text-destructive"
              count={result?.semNota.length ?? 0}
            >
              <Paged rows={result?.semNota ?? []}>
                {(visible) => (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Confirmação</TableHead>
                        <TableHead>RPS / Fiscal Bill</TableHead>
                        <TableHead>Hóspede</TableHead>
                        <TableHead>Propriedade</TableHead>
                        <TableHead>Check-in</TableHead>
                        <TableHead>Check-out</TableHead>
                        <TableHead className="text-right">Linhas</TableHead>
                        <TableHead className="text-right">Pago</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((item) => (
                        <TableRow
                          key={item.reservation!.confirmationNumber}
                          className="bg-red-50/50 dark:bg-red-900/10"
                        >
                          <TableCell className="font-mono text-xs">
                            {item.reservation!.confirmationNumber}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.reservation!.lines.map((l) => l.fiscalBillNumber).filter(Boolean).join(", ") || "—"}
                          </TableCell>
                          <TableCell>{item.reservation!.guestName}</TableCell>
                          <TableCell className="text-xs">
                            {item.reservation!.property || "—"}
                          </TableCell>
                          <TableCell>{item.reservation!.arrival}</TableCell>
                          <TableCell>{item.reservation!.departure}</TableCell>
                          <TableCell className="text-right text-xs">
                            {item.reservation!.lines.length}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {fmtBRL(item.reservation!.totalPayment)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {fmtBRL(item.reservation!.totalNet)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Paged>
            </SectionCard>

            <SectionCard
              title="Divergências (confirmação bate, mas algo não confere)"
              icon={<AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />}
              colorClass="text-amber-700 dark:text-amber-400"
              count={result?.divergencias.length ?? 0}
            >
              <Paged rows={result?.divergencias ?? []}>
                {(visible) => (
                  <div className="space-y-3">
                    {visible.map((item) => (
                      <div
                        key={item.reservation!.confirmationNumber}
                        className="text-sm border rounded-md p-3 bg-amber-50/40 dark:bg-amber-900/10"
                      >
                        <p className="font-medium">
                          {item.reservation!.confirmationNumber} · {item.reservation!.guestName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          RPS: {item.reservation!.lines.map((l) => l.fiscalBillNumber).filter(Boolean).join(", ") || "—"}
                          {" · Nota: "}
                          {item.notas.map((n) => n.numeroNfse).join(", ") || "—"}
                        </p>
                        <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside">
                          {item.motivos.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Paged>
            </SectionCard>

            {(result?.conciliados.length ?? 0) > 0 && (
              <Card className="p-4 shadow-soft flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Conciliadas corretamente
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result?.conciliados.length} reserva(s) · total {fmtBRL(result?.totals.conciliadosTotal ?? 0)}
                  </p>
                </div>
              </Card>
            )}


            <SectionCard
              title="Notas sem reserva correspondente no Opera"
              icon={<HelpCircle className="h-5 w-5 text-muted-foreground shrink-0" />}
              colorClass="text-muted-foreground"
              count={result?.semReservaOpera.length ?? 0}
            >
              <Paged rows={result?.semReservaOpera ?? []}>
                {(visible) => (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nota</TableHead>
                        <TableHead>RPS</TableHead>
                        <TableHead>Confirmação</TableHead>
                        <TableHead>Hóspede (descrição)</TableHead>
                        <TableHead>Check-in</TableHead>
                        <TableHead>Check-out</TableHead>
                        <TableHead>Emissão</TableHead>
                        <TableHead>Competência</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.flatMap((item) =>
                        item.notas.map((n) => (
                          <TableRow key={n.numeroNfse}>
                            <TableCell className="font-mono text-xs">{n.numeroNfse}</TableCell>
                            <TableCell className="font-mono text-xs">{n.rps ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {n.confirmationNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">{n.guestNameExtracted ?? "—"}</TableCell>
                            <TableCell className="text-xs">{n.checkIn ?? "—"}</TableCell>
                            <TableCell className="text-xs">{n.checkOut ?? "—"}</TableCell>
                            <TableCell className="text-xs">{n.dataGeracao || "—"}</TableCell>
                            <TableCell className="text-xs">{n.competencia || "—"}</TableCell>
                            <TableCell className="text-xs">{n.situacao || "—"}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {fmtBRL(n.valorServico)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.motivos.join(" | ")}
                            </TableCell>
                          </TableRow>
                        )),
                      )}
                    </TableBody>
                  </Table>
                )}
              </Paged>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
