import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClosing, useEnsureClosing } from "@/hooks/useClosings";
import { useDreVersions, useUploadDre, getDreSignedUrl } from "@/hooks/useDre";
import { CommentsThread } from "@/components/closings/CommentsThread";
import { ApprovalActions } from "@/components/closings/ApprovalActions";
import { DreStageStepper } from "@/components/closings/DreStageStepper";
import { StatusBadge } from "@/components/closings/StatusBadge";
import { DreIndicatorsPanel } from "@/components/closings/DreIndicatorsPanel";
import { MONTHS_PT, STATUS_LABELS } from "@/lib/constants";
import { ArrowLeft, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

export default function DrePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { hotelId, month, year } = useModuleFilters("fechamento");
  const { user, allowedHotels, hasRole, isMaster } = useAuth();
  const ensure = useEnsureClosing();
  const upload = useUploadDre();

  const closingIdParam = params.get("closing");
  const [resolvedId, setResolvedId] = useState<string | null>(closingIdParam);

  // Quando o filtro de hotel/mês/ano muda (e não viemos via ?closing= explícito),
  // re-resolve o closing correspondente. Sem isso, a página fica presa no
  // primeiro closing carregado até o usuário atualizar a página.
  useEffect(() => {
    if (closingIdParam) return; // navegação direta com id
    if (!hotelId) {
      setResolvedId(null);
      return;
    }
    let cancelled = false;
    ensure
      .mutateAsync({ hotelId, month, year })
      .then((c) => {
        if (!cancelled) setResolvedId(c.id);
      })
      .catch((err) => toast.error(err.message));
    return () => {
      cancelled = true;
    };
  }, [closingIdParam, hotelId, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: closing } = useClosing(resolvedId);
  const { data: versions = [] } = useDreVersions(resolvedId);

  const fileRef = useRef<HTMLInputElement>(null);
  const canUpload = isMaster || hasRole("controladoria") || hasRole("gop");

  const hotel = useMemo(
    () => allowedHotels.find((h) => h.id === closing?.hotel_id),
    [allowedHotels, closing?.hotel_id],
  );

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !resolvedId || !user) return;
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
      toast.error("Envie um arquivo Excel (.xlsx, .xlsm, .xls) ou .csv");
      return;
    }
    try {
      const r = await upload.mutateAsync({
        closingId: resolvedId,
        file,
        userId: user.id,
        month: closing?.month ?? month,
      });
      toast.success(`Versão v${r.version} enviada — modelo detectado: ${r.template}${r.isFirst ? " (primeira)" : ""}`);
      if (r.warnings?.length) {
        toast.warning(`Atenção no parsing: ${r.warnings.join("; ")}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    }
  }

  async function downloadVersion(path: string, name: string) {
    const url = await getDreSignedUrl(path);
    if (!url) {
      toast.error("Não foi possível gerar link");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!hotelId && !resolvedId) {
    return (
      <div className="max-w-2xl mx-auto pt-12">
        <Card className="p-8 text-center shadow-soft">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Selecione um hotel</h2>
          <p className="text-sm text-muted-foreground">
            Use o filtro de hotel no topo para abrir um fechamento.
          </p>
        </Card>
      </div>
    );
  }

  if (!closing) {
    return (
      <div className="text-sm text-muted-foreground">Carregando fechamento…</div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="gap-2 mb-2 -ml-2" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
          </Button>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">DRE</p>
          <h1 className="text-2xl font-semibold text-foreground">{hotel?.name ?? closing.hotel_id}</h1>
          <p className="text-sm text-muted-foreground">
            {MONTHS_PT[closing.month - 1]} de {closing.year}
          </p>
        </div>
        <div className="text-right space-y-2">
          <StatusBadge status={closing.status_dre} size="md" />
          {closing.status_dre === "devolvido" && (
            <p className="text-xs text-destructive">DRE devolvida — corrigir e reenviar.</p>
          )}
        </div>
      </div>

      <Card className="p-5 shadow-soft">
        <DreStageStepper status={closing.status_dre} />
      </Card>

      <DreIndicatorsPanel closingId={closing.id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COL 1-2: Upload + versões + ações */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5 shadow-soft">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider">Planilha DRE</h3>
              {canUpload && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xlsm,.xls,.csv"
                    className="hidden"
                    onChange={handleFile}
                  />
                  <Button size="sm" className="gap-2" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    {upload.isPending ? "Enviando…" : versions.length === 0 ? "Enviar DRE" : "Enviar nova versão"}
                  </Button>
                </>
              )}
            </div>

            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Nenhuma versão enviada ainda. {canUpload ? "Faça upload do Excel para iniciar o ciclo." : "Aguarde a Controladoria ou GOP enviar a planilha."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                    <TableHead className="text-xs uppercase tracking-wider">Versão</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Arquivo</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Enviado em</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">v{v.version_number}</TableCell>
                      <TableCell className="text-sm">{v.file_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(v.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => downloadVersion(v.file_url, v.file_name)}>
                          <Download className="h-3.5 w-3.5" /> Baixar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="p-5 shadow-soft">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Ações do estágio</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Estágio atual: <strong className="text-foreground">{STATUS_LABELS[closing.status_dre]}</strong>
            </p>
            <ApprovalActions
              closingId={closing.id}
              stage="dre"
              currentStatus={closing.status_dre}
            />
          </Card>
        </div>

        {/* COL 3: Comentários */}
        <div>
          <CommentsThread closingId={closing.id} stage="dre" />
        </div>
      </div>
    </div>
  );
}