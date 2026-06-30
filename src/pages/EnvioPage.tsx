import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useEnvioQueue,
  useMarkEnvioSent,
  useReopenEnvio,
  type EnvioRow,
} from "@/hooks/useEnvio";
import { getLetterPdfSignedUrl } from "@/hooks/useLetter";
import { MONTHS_PT, formatBRL } from "@/lib/constants";
import {
  Send, CheckCircle2, FileText, Download, Clock, AlertTriangle, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

export default function EnvioPage() {
  const { hotelId, month, year } = useModuleFilters("fechamento");
  const { allowedHotels, hasRole, isMaster, isFernando } = useAuth();
  const { data: rows = [], isLoading } = useEnvioQueue({ month, year, hotelId });
  const markSent = useMarkEnvioSent();
  const reopen = useReopenEnvio();

  const canSend = !isFernando && (isMaster || hasRole("ri"));
  const [confirmRow, setConfirmRow] = useState<EnvioRow | null>(null);
  const [reopenRow, setReopenRow] = useState<EnvioRow | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const hotelById = useMemo(
    () => new Map(allowedHotels.map((h) => [h.id, h])),
    [allowedHotels],
  );

  async function handleConfirm() {
    if (!confirmRow) return;
    try {
      await markSent.mutateAsync({ closingId: confirmRow.id });
      toast.success("Envio registrado.");
      setConfirmRow(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar envio");
    }
  }

  async function handleReopen() {
    if (!reopenRow) return;
    try {
      await reopen.mutateAsync({ closingId: reopenRow.id });
      toast.success("Envio reaberto.");
      setReopenRow(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reabrir envio");
    }
  }

  async function handleDownload(row: EnvioRow) {
    if (!row.pdf_url) return;
    setDownloadingId(row.id);
    try {
      // pdf_url é o caminho relativo no bucket "investor-letters".
      // Se já vier como URL absoluta (http/https), abre direto.
      const url = /^https?:\/\//i.test(row.pdf_url)
        ? row.pdf_url
        : await getLetterPdfSignedUrl(row.pdf_url);
      if (!url) {
        toast.error("Não foi possível gerar o link de download.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao baixar PDF");
    } finally {
      setDownloadingId(null);
    }
  }

  const stats = useMemo(() => {
    const sent = rows.filter((r) => r.status_envio === "aprovado").length;
    const pending = rows.length - sent;
    return { sent, pending, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Workflow</p>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Send className="h-6 w-6" /> Envio aos Investidores
        </h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_PT[month - 1]} de {year} — fechamentos com Carta aprovada
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Cartas Prontas
            </span>
            <FileText className="h-4 w-4 text-accent" />
          </div>
          <p className="text-3xl font-semibold text-foreground">{stats.total}</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Enviadas
            </span>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <p className="text-3xl font-semibold text-success">{stats.sent}</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pendentes
            </span>
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <p className="text-3xl font-semibold text-warning">{stats.pending}</p>
        </Card>
      </div>

      <Card className="p-5 shadow-soft">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma carta aprovada para este período ainda.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                <TableHead className="text-xs uppercase tracking-wider">Hotel</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Distribuição</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">PDF</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const hotel = hotelById.get(row.hotel_id);
                const distribution = row.final_distribution ?? row.estimated_distribution ?? 0;
                const sent = row.status_envio === "aprovado";
                const hasPdf = !!row.pdf_url;
                const finDecided = !!row.distribution_decision;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {hotel?.name ?? row.hotel_id}
                    </TableCell>
                    <TableCell>
                      {distribution > 0 ? (
                        <span className="font-medium text-success">
                          {formatBRL(distribution)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {!finDecided && (
                        <Badge variant="outline" className="ml-2 gap-1 text-[10px] text-warning border-warning/30">
                          <AlertTriangle className="h-3 w-3" /> Financeiro pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {hasPdf ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={downloadingId === row.id}
                          onClick={() => handleDownload(row)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {downloadingId === row.id ? "Abrindo…" : "Baixar"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">PDF não gerado</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {sent ? (
                        <Badge variant="outline" className="gap-1 bg-success/15 text-success border-success/30">
                          <CheckCircle2 className="h-3 w-3" />
                          Enviado
                          {row.envio_sent_at && (
                            <span className="ml-1 opacity-70">
                              · {new Date(row.envio_sent_at).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 bg-warning/15 text-warning border-warning/30">
                          <Clock className="h-3 w-3" /> Aguardando envio
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canSend && (
                        sent ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => setReopenRow(row)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!hasPdf}
                            className="gap-1"
                            onClick={() => setConfirmRow(row)}
                          >
                            <Send className="h-3.5 w-3.5" /> Marcar enviado
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Confirmação de envio */}
      <Dialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar envio</DialogTitle>
            <DialogDescription>
              {confirmRow && (hotelById.get(confirmRow.hotel_id)?.name ?? confirmRow.hotel_id)} — {MONTHS_PT[month - 1]} de {year}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirme que a Carta ao Investidor foi enviada aos destinatários.
            Esta ação registra o envio e marca o estágio como concluído.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRow(null)}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={markSent.isPending} className="gap-1">
              <CheckCircle2 className="h-4 w-4" />
              {markSent.isPending ? "Registrando…" : "Confirmar envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reabrir envio */}
      <Dialog open={!!reopenRow} onOpenChange={(o) => !o && setReopenRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reabrir envio</DialogTitle>
            <DialogDescription>
              {reopenRow && (hotelById.get(reopenRow.hotel_id)?.name ?? reopenRow.hotel_id)}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O envio voltará para o status "Em andamento". Use apenas se for necessário reenviar.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenRow(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReopen} disabled={reopen.isPending}>
              {reopen.isPending ? "Reabrindo…" : "Reabrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
