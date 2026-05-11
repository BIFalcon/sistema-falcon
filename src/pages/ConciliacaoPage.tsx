import { useState, useMemo, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { parseRazao, parseJournal, type RazaoLine, type JournalLine } from "@/lib/conciliationParser";
import { useConciliation, type CategoryResult } from "@/hooks/useConciliation";
import { fmtBRL } from "@/lib/formatters";

function DropZone({
  label,
  file,
  onFile,
  accept,
}: {
  label: string;
  file: File | null;
  onFile: (f: File) => void;
  accept: Record<string, string[]>;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
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

function CategoryCard({ result }: { result: CategoryResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasMissing = result.apenasNoJournal.length > 0 || result.apenasNoRazao.length > 0;
  const hasData = result.totalDebito > 0 || result.totalJournal > 0;

  if (!hasData) return null;

  return (
    <Card className="overflow-hidden shadow-soft">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30"
        onClick={() => hasMissing && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {result.conciliado ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive shrink-0" />
          )}
          <div>
            <p className="font-semibold text-sm">{result.categoria}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {result.emAmbos.length + result.apenasNoRazao.length} lançamentos no TOTVS
              {result.apenasNoJournal.length > 0 && (
                <span className="text-destructive font-medium ml-1">
                  · {result.apenasNoJournal.length} não subiram do Opera
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-right">
          <div>
            <p className="text-xs text-muted-foreground">TOTVS (débito)</p>
            <p className="text-sm font-semibold">{fmtBRL(result.totalDebito)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">TOTVS (créditos)</p>
            <p className={`text-sm font-semibold ${!result.conciliado ? "text-destructive" : ""}`}>
              {fmtBRL(result.totalCreditoRazao)}
            </p>
          </div>
          {result.totalJournal > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Opera (Journal)</p>
              <p className="text-sm font-semibold">{fmtBRL(result.totalJournal)}</p>
            </div>
          )}
          {!result.conciliado && (
            <div>
              <p className="text-xs text-muted-foreground">Divergência</p>
              <p className="text-sm font-bold text-destructive">
                {fmtBRL(Math.abs(result.divergencia))}
              </p>
            </div>
          )}
          {hasMissing && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      {expanded && hasMissing && (
        <div className="border-t">
          {result.apenasNoJournal.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  {result.apenasNoJournal.length} lançamento(s) no Opera que não subiram para o TOTVS
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº Transação</TableHead>
                    <TableHead>Hóspede</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.apenasNoJournal.map((l) => (
                    <TableRow key={l.transactionNumber} className="bg-amber-50/50 dark:bg-amber-900/10">
                      <TableCell className="font-mono text-xs">{l.transactionNumber}</TableCell>
                      <TableCell>{l.guestFullName || l.companyName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {l.transactionCode} · {l.transactionDescription}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400">
                        {fmtBRL(l.credit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {result.apenasNoRazao.length > 0 && (
            <div className="p-4 border-t">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                  {result.apenasNoRazao.length} lançamento(s) no TOTVS sem correspondência no Opera
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Histórico</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.apenasNoRazao.map((l) => (
                    <TableRow key={l.lancamento} className="bg-blue-50/50 dark:bg-blue-900/10">
                      <TableCell className="font-mono text-xs">{l.documento}</TableCell>
                      <TableCell className="text-xs">{l.historico}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtBRL(l.valorCredito)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ConciliacaoPage() {
  const [razaoFile, setRazaoFile] = useState<File | null>(null);
  const [journalFile, setJournalFile] = useState<File | null>(null);
  const [razaoLines, setRazaoLines] = useState<RazaoLine[]>([]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const uniqueDates = useMemo(
    () => [...new Set(razaoLines.map((l) => l.date).filter(Boolean))].sort(),
    [razaoLines]
  );

  useEffect(() => {
    if (uniqueDates.length > 0 && !selectedDate) {
      setSelectedDate(uniqueDates[0]);
    }
  }, [uniqueDates, selectedDate]);

  const filteredRazao = useMemo(
    () => (selectedDate ? razaoLines.filter((l) => l.date === selectedDate) : razaoLines),
    [razaoLines, selectedDate]
  );
  const filteredJournal = useMemo(
    () => (selectedDate ? journalLines.filter((l) => l.date === selectedDate) : journalLines),
    [journalLines, selectedDate]
  );

  const result = useConciliation(filteredRazao, filteredJournal);

  const handleProcess = async () => {
    if (!razaoFile) { toast.error("Selecione o arquivo do Razão (TOTVS)"); return; }
    setProcessing(true);
    try {
      const [razao, journal] = await Promise.all([
        parseRazao(razaoFile),
        journalFile ? parseJournal(journalFile) : Promise.resolve([]),
      ]);
      setRazaoLines(razao);
      setJournalLines(journal);
      setProcessed(true);
      toast.success(`Processado: ${razao.length} linhas do Razão${journal.length ? `, ${journal.length} do Journal` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar arquivos");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setRazaoFile(null);
    setJournalFile(null);
    setRazaoLines([]);
    setJournalLines([]);
    setProcessed(false);
    setSelectedDate("");
  };

  const xlsxAccept = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    "application/vnd.ms-excel": [".xls"],
  };

  return (
    <div className="space-y-6 max-w-[1100px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Controladoria
        </p>
        <h1 className="text-2xl font-semibold">Conciliação TOTVS × Opera</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Importe o Razão do TOTVS e o Journal do Oracle R&A para verificar divergências.
        </p>
      </div>

      {!processed ? (
        <Card className="p-6 shadow-soft space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Razão — TOTVS (obrigatório)
              </p>
              <DropZone
                label="Razão exportado do TOTVS (.xlsx)"
                file={razaoFile}
                onFile={setRazaoFile}
                accept={xlsxAccept}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Journal — Oracle R&A (opcional)
              </p>
              <DropZone
                label="FIN01105 Journal exportado do Oracle R&A (.xlsx)"
                file={journalFile}
                onFile={setJournalFile}
                accept={xlsxAccept}
              />
            </div>
          </div>
          <Button
            onClick={handleProcess}
            disabled={!razaoFile || processing}
            className="w-full"
          >
            {processing ? "Processando..." : "Analisar conciliação"}
          </Button>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {result?.hasErrors ? (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-5 w-5" />
                  <span className="font-semibold">Divergências encontradas</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Tudo conciliado</span>
                </div>
              )}
              {uniqueDates.length > 0 && (
                <Select value={selectedDate} onValueChange={setSelectedDate}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue placeholder="Selecione a data" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueDates.map((d) => (
                      <SelectItem key={d} value={d}>
                        {new Date(d + "T12:00:00").toLocaleDateString("pt-BR")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-xs text-muted-foreground">
                {uniqueDates.length} dia(s)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {result?.hasErrors && selectedDate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportDivergencias(result.categories, selectedDate)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportar divergências
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleReset}>
                Nova análise
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {result?.categories.map((cat) => (
              <CategoryCard key={cat.categoria} result={cat} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function exportDivergencias(categories: CategoryResult[], date: string) {
  const rows: unknown[][] = [
    ["Categoria", "Nº Transação", "Hóspede / Empresa", "Tipo Cartão", "Valor", "Status"],
  ];

  for (const cat of categories) {
    if (cat.conciliado) continue;
    for (const j of cat.apenasNoJournal) {
      rows.push([
        cat.categoria,
        j.transactionNumber,
        j.guestFullName || j.companyName || "—",
        `${j.transactionCode} · ${j.transactionDescription}`,
        j.credit,
        "No Opera, não subiu pro TOTVS",
      ]);
    }
    for (const r of cat.apenasNoRazao) {
      rows.push([
        cat.categoria,
        r.documento,
        r.historico,
        "—",
        r.valorCredito,
        "No TOTVS, sem origem no Opera",
      ]);
    }
  }

  if (rows.length === 1) return;

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Divergências");
  const dateFormatted = new Date(date + "T12:00:00")
    .toLocaleDateString("pt-BR")
    .replace(/\//g, "-");
  XLSX.writeFile(wb, `divergencias-${dateFormatted}.xlsx`);
}