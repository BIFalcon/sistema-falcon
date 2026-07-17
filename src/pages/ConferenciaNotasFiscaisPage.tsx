import { useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  parseOperaReservations,
  parsePrefeituraNotas,
  type OperaReservation,
  type PrefeituraNota,
} from "@/lib/nfConferenceParser";
import { useNfConference } from "@/hooks/useNfConference";
import { fmtBRL } from "@/lib/formatters";

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

export default function ConferenciaNotasFiscaisPage() {
  const [operaFile, setOperaFile] = useState<File | null>(null);
  const [prefeituraFile, setPrefeituraFile] = useState<File | null>(null);
  const [reservations, setReservations] = useState<OperaReservation[]>([]);
  const [notas, setNotas] = useState<PrefeituraNota[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);

  const result = useNfConference(reservations, notas);

  const handleProcess = async () => {
    if (!operaFile || !prefeituraFile) {
      toast.error("Selecione os dois arquivos (Opera R&A e Prefeitura)");
      return;
    }
    setProcessing(true);
    try {
      const [res, nfs] = await Promise.all([
        parseOperaReservations(operaFile),
        parsePrefeituraNotas(prefeituraFile),
      ]);
      setReservations(res);
      setNotas(nfs);
      setProcessed(true);
      toast.success(
        `Processado: ${res.length} reservas do Opera, ${nfs.length} notas da Prefeitura`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar arquivos");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setOperaFile(null);
    setPrefeituraFile(null);
    setReservations([]);
    setNotas([]);
    setProcessed(false);
  };

  const handleExport = () => {
    if (!result) return;
    const rows: unknown[][] = [
      ["Status", "Confirmação", "RPS", "Nota", "Hóspede (Opera)", "Check-in", "Check-out", "Valor (R$)", "Motivo"],
    ];
    for (const item of [...result.semNota, ...result.divergencias]) {
      const rps = item.reservation?.lines.map((l) => l.fiscalBillNumber).filter(Boolean).join(", ") ?? "";
      const nfs = item.notas.map((n) => n.numeroNfse).join(", ");
      rows.push([
        item.status === "sem_nota" ? "Sem nota emitida" : "Divergência",
        item.reservation?.confirmationNumber ?? "—",
        rps || "—",
        nfs || "—",
        item.reservation?.guestName ?? "—",
        item.reservation?.arrival ?? "—",
        item.reservation?.departure ?? "—",
        item.reservation?.totalNet ?? 0,
        item.motivos.join(" | "),
      ]);
    }
    for (const nota of result.semConfirmacaoIdentificada) {
      rows.push([
        "Revisão manual",
        "—",
        nota.rps ?? "—",
        nota.numeroNfse,
        nota.descricao.slice(0, 60),
        "—",
        "—",
        nota.valorServico,
        `Nota ${nota.numeroNfse} sem confirmação identificável no texto`,
      ]);
    }
    if (rows.length === 1) return;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conferência NF");
    XLSX.writeFile(wb, `conferencia-notas-fiscais-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

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

      {!processed ? (
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
            disabled={!operaFile || !prefeituraFile || processing}
            className="w-full"
          >
            {processing ? "Processando..." : "Analisar conferência"}
          </Button>
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
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Exportar
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                Nova análise
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <SectionCard
              title="Sem nota emitida"
              icon={<XCircle className="h-5 w-5 text-destructive shrink-0" />}
              colorClass="text-destructive"
              count={result?.semNota.length ?? 0}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Confirmação</TableHead>
                    <TableHead>RPS</TableHead>
                    <TableHead>Hóspede</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result?.semNota ?? []).map((item) => (
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
                      <TableCell>{item.reservation!.arrival}</TableCell>
                      <TableCell>{item.reservation!.departure}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtBRL(item.reservation!.totalNet)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>

            <SectionCard
              title="Divergências (confirmação bate, mas algo não confere)"
              icon={<AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />}
              colorClass="text-amber-700 dark:text-amber-400"
              count={result?.divergencias.length ?? 0}
            >
              <div className="space-y-3">
                {(result?.divergencias ?? []).map((item) => (
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
              title="Notas sem confirmação identificável (revisão manual)"
              icon={<HelpCircle className="h-5 w-5 text-blue-500 shrink-0" />}
              colorClass="text-blue-700 dark:text-blue-400"
              count={result?.semConfirmacaoIdentificada.length ?? 0}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nota</TableHead>
                    <TableHead>RPS</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result?.semConfirmacaoIdentificada ?? []).map((nota) => (
                    <TableRow key={nota.numeroNfse}>
                      <TableCell className="font-mono text-xs">{nota.numeroNfse}</TableCell>
                      <TableCell className="font-mono text-xs">{nota.rps ?? "—"}</TableCell>
                      <TableCell className="text-xs">{nota.descricao}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtBRL(nota.valorServico)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>

            <SectionCard
              title="Notas sem reserva correspondente no Opera"
              icon={<HelpCircle className="h-5 w-5 text-muted-foreground shrink-0" />}
              colorClass="text-muted-foreground"
              count={result?.semReservaOpera.length ?? 0}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RPS / Confirmação</TableHead>
                    <TableHead>Nota(s)</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result?.semReservaOpera ?? []).map((item) => (
                    <TableRow key={item.motivos[0]}>
                      <TableCell className="font-mono text-xs">
                        {item.notas[0]?.rps ?? item.notas[0]?.confirmationNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.notas.map((n) => n.numeroNfse).join(", ")}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtBRL(item.notas.reduce((sum, n) => sum + n.valorServico, 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}