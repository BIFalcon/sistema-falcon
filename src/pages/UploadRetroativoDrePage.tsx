import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { MONTHS_PT } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { Upload, ShieldAlert, FileSpreadsheet } from "lucide-react";
import { Navigate } from "react-router-dom";
import { uploadRetroactiveDre, type RetroUploadResult } from "@/lib/retroactiveDreUpload";

const DRE_FILE_EXTENSIONS = /\.(xlsx|xlsm|xls|csv)$/i;

export default function UploadRetroativoDrePage() {
  const { user, isMaster, allowedHotels } = useAuth();
  const [hotelId, setHotelId] = useState<string>("");
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [upToMonth, setUpToMonth] = useState<number>(12);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RetroUploadResult | null>(null);

  if (!isMaster) {
    return <Navigate to="/" replace />;
  }

  const years = [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !hotelId || !file) {
      toast({
        title: "Campos obrigatórios",
        description: "Selecione hotel, ano e arquivo.",
        variant: "destructive",
      });
      return;
    }
    if (!DRE_FILE_EXTENSIONS.test(file.name)) {
      toast({
        title: "Formato inválido",
        description: "Envie um arquivo Excel (.xlsx, .xlsm, .xls) ou .csv.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await uploadRetroactiveDre({
        hotelId,
        year,
        file,
        userId: user.id,
        upToMonth,
      });
      setResult(res);
      toast({
        title: "DRE enviada",
        description:
          res.monthsProcessed.length > 0
            ? `${res.monthsProcessed.length} ${
                res.monthsProcessed.length === 1 ? "mês" : "meses"
              } processado(s): ${res.monthsProcessed
                .map((m) => MONTHS_PT[m - 1])
                .join(", ")}`
            : "Nenhum mês com dados encontrado na planilha.",
      });
      setFile(null);
      const input = document.getElementById("dre-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (err) {
      toast({
        title: "Erro no upload",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Configurações
        </p>
        <h1 className="text-2xl font-semibold text-foreground">
          Upload retroativo de DRE
        </h1>
        <p className="text-sm text-muted-foreground">
          Permite a Masters carregar uma DRE histórica e armazenar de uma só vez
          os dados de todos os meses presentes nas colunas do arquivo. Não passa
          pelo workflow de aprovação — cada mês detectado é marcado como aprovado
          e fica disponível em Indicadores DRE.
        </p>
      </header>

      <Card className="p-5 shadow-soft border-warning/40 bg-warning/5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-warning mt-0.5" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Use com responsabilidade</p>
            <p className="text-muted-foreground">
              O upload aqui pula o workflow de fechamento. Selecione o ano da
              DRE — o sistema lê todas as colunas de meses presentes na planilha
              e armazena cada mês como um fechamento aprovado.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 shadow-soft">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="hotel">Hotel</Label>
              <Select value={hotelId} onValueChange={setHotelId}>
                <SelectTrigger id="hotel">
                  <SelectValue placeholder="Selecione o hotel" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {allowedHotels.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Ano</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Processar até o mês</Label>
            <Select value={String(upToMonth)} onValueChange={(v) => setUpToMonth(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {MONTHS_PT.map((label, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dre-file">Arquivo da DRE (.xlsx, .xlsm, .xls)</Label>
            <Input
              id="dre-file"
              type="file"
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                if (!selected) {
                  setFile(null);
                  return;
                }
                if (!DRE_FILE_EXTENSIONS.test(selected.name)) {
                  setFile(null);
                  e.currentTarget.value = "";
                  toast({
                    title: "Formato inválido",
                    description: "Envie um arquivo Excel (.xlsx, .xlsm, .xls) ou .csv.",
                    variant: "destructive",
                  });
                  return;
                }
                setFile(selected);
              }}
            />
            {file && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !file || !hotelId}>
              <Upload className="h-4 w-4 mr-2" />
              {submitting ? "Processando…" : "Carregar DRE"}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <Card className="p-5 shadow-soft">
          <h2 className="text-sm font-semibold mb-3">Resumo do processamento</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Meses detectados</p>
              <p className="font-semibold text-foreground">
                {result.monthsDetected.length > 0
                  ? result.monthsDetected.map((m) => MONTHS_PT[m - 1]).join(", ")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Processados com sucesso</p>
              <p className="font-semibold text-success">
                {result.monthsProcessed.length > 0
                  ? result.monthsProcessed.map((m) => MONTHS_PT[m - 1]).join(", ")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Falhas</p>
              <p className="font-semibold text-destructive">
                {result.monthsFailed.length > 0
                  ? result.monthsFailed
                      .map((m) => `${MONTHS_PT[m.month - 1]} (${m.error})`)
                      .join("; ")
                  : "—"}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}