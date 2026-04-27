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
import { supabase } from "@/integrations/supabase/client";
import { MONTHS_PT, sanitizeFileName } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { Upload, ShieldAlert, FileSpreadsheet } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function UploadRetroativoDrePage() {
  const { user, isMaster, allowedHotels } = useAuth();
  const [hotelId, setHotelId] = useState<string>("");
  const currentYear = new Date().getFullYear();
  const [month, setMonth] = useState<number>(1);
  const [year, setYear] = useState<number>(currentYear);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isMaster) {
    return <Navigate to="/" replace />;
  }

  const years = [currentYear - 2, currentYear - 1, currentYear];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !hotelId || !file) {
      toast({
        title: "Campos obrigatórios",
        description: "Selecione hotel, mês, ano e arquivo.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      // 1. Find or create closing
      const { data: existing, error: findErr } = await supabase
        .from("closings")
        .select("id, status_dre")
        .eq("hotel_id", hotelId)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle();
      if (findErr) throw findErr;

      let closingId = existing?.id;
      if (!closingId) {
        const { data: created, error: createErr } = await supabase
          .from("closings")
          .insert({
            hotel_id: hotelId,
            year,
            month,
            status_dre: "aprovado",
          })
          .select("id")
          .single();
        if (createErr) throw createErr;
        closingId = created.id;
      }

      // 2. Compute next version
      const { data: lastVer } = await supabase
        .from("dre_versions")
        .select("version_number")
        .eq("closing_id", closingId)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (lastVer?.[0]?.version_number ?? 0) + 1;

      // 3. Upload file to storage
      const cleanName = sanitizeFileName(file.name);
      const path = `${closingId}/v${nextVersion}_${cleanName}`;
      const { error: upErr } = await supabase.storage
        .from("closings")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // 4. Insert dre_versions row
      const { error: insErr } = await supabase.from("dre_versions").insert({
        closing_id: closingId,
        version_number: nextVersion,
        file_url: path,
        file_name: file.name,
        author_id: user.id,
      });
      if (insErr) throw insErr;

      // 5. Force status to aprovado (skip workflow)
      if (existing?.status_dre !== "aprovado") {
        await supabase
          .from("closings")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ status_dre: "aprovado" } as any)
          .eq("id", closingId);
      }

      toast({
        title: "DRE enviada",
        description: `${MONTHS_PT[month - 1]}/${year} carregada com sucesso.`,
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
          Permite a Masters carregar DREs de meses anteriores diretamente, sem
          passar pelo fluxo de aprovação. O arquivo será marcado como aprovado
          imediatamente e ficará disponível em Indicadores DRE.
        </p>
      </header>

      <Card className="p-5 shadow-soft border-warning/40 bg-warning/5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-warning mt-0.5" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Use com responsabilidade</p>
            <p className="text-muted-foreground">
              O upload aqui pula o workflow de fechamento. Ideal apenas para
              importações históricas (ex.: Janeiro/Fevereiro/Março de 2026).
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 shadow-soft">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-3">
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
              <Label>Mês</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {MONTHS_PT.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {m}
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
            <Label htmlFor="dre-file">Arquivo da DRE (.xlsx)</Label>
            <Input
              id="dre-file"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
              {submitting ? "Enviando…" : "Carregar DRE"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}