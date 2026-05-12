import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useFinanceiroQueue,
  useRecordDistribution,
  type FinanceiroRow,
  type DistributionDecision,
} from "@/hooks/useFinanceiro";
import { MONTHS_PT, formatBRL } from "@/lib/constants";
import { Wallet, CheckCircle2, XCircle, Clock, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { EstimatedLine } from "@/lib/dreEstimator";
import { useClosingFinanceMetrics } from "@/hooks/useConsolidado";

function lucroFromLines(lines: unknown): { value: number | null; source: string } {
  if (!Array.isArray(lines)) return { value: null, source: "no_history" };
  const lucro = (lines as EstimatedLine[]).find((l) => l.key === "lucro_liquido");
  return { value: lucro?.value ?? null, source: lucro?.source ?? "no_history" };
}

export default function FinanceiroPage() {
  const { hotelId, month, year } = useModuleFilters("fechamento");
  const { user, allowedHotels, hasRole, isMaster, isFinanceiroCoordenadora, isFernando } = useAuth();
  const { data: rows = [], isLoading } = useFinanceiroQueue({ month, year, hotelId });
  const record = useRecordDistribution();

  const canActOnFechamento = isMaster || !isFinanceiroCoordenadora;
  const canDecide = !isFernando && (isMaster || hasRole("financeiro")) && canActOnFechamento;
  const [openRow, setOpenRow] = useState<FinanceiroRow | null>(null);
  const [decision, setDecision] = useState<DistributionDecision>("enviado");
  const [valueStr, setValueStr] = useState("");
  const [notes, setNotes] = useState("");
  const { data: metrics } = useClosingFinanceMetrics(openRow?.id ?? null);

  const hotelById = useMemo(() => {
    const m = new Map(allowedHotels.map((h) => [h.id, h]));
    return m;
  }, [allowedHotels]);

  function openDialog(row: FinanceiroRow) {
    setOpenRow(row);
    const def = row.estimated_distribution ?? 0;
    setDecision(def > 0 ? "enviado" : "sem_distribuicao");
    setValueStr(def > 0 ? String(def) : "");
    setNotes(row.distribution_notes ?? "");
  }

  async function submit() {
    if (!openRow || !user) return;
    const finalValue = decision === "enviado" ? Number(valueStr.replace(",", ".")) : null;
    if (decision === "enviado" && (!finalValue || !Number.isFinite(finalValue) || finalValue <= 0)) {
      toast.error("Informe um valor de distribuição maior que zero.");
      return;
    }
    try {
      await record.mutateAsync({
        closingId: openRow.id,
        decision,
        finalValue,
        notes: notes.trim() || null,
        userId: user.id,
      });
      toast.success("Decisão registrada.");
      setOpenRow(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar");
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Workflow</p>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Wallet className="h-6 w-6" /> Financeiro
        </h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_PT[month - 1]} de {year} — fechamentos com DRE aprovada
        </p>
      </div>

      <Card className="p-5 shadow-soft">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhum fechamento com DRE aprovada para este período ainda.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                <TableHead className="text-xs uppercase tracking-wider">Hotel</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Lucro Líquido (DRE)</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Distribuição</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Decisão</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const hotel = hotelById.get(row.hotel_id);
                const { value: lucro, source } = lucroFromLines(row.estimated_lines);
                const distribution = row.final_distribution ?? row.estimated_distribution ?? 0;
                const decisionLabel: Record<DistributionDecision, { label: string; tone: string; icon: React.ElementType }> = {
                  enviado: { label: "Enviado", tone: "bg-success/15 text-success border-success/30", icon: CheckCircle2 },
                  sem_distribuicao: { label: "Sem Distribuição", tone: "bg-muted text-muted-foreground border-border", icon: XCircle },
                  pendente: { label: "Pendente", tone: "bg-warning/15 text-warning border-warning/30", icon: Clock },
                };
                const dec = row.distribution_decision ? decisionLabel[row.distribution_decision] : null;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {hotel?.name ?? row.hotel_id}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={lucro != null && lucro < 0 ? "text-destructive font-medium" : "font-medium"}>
                          {formatBRL(lucro ?? 0)}
                        </span>
                        {source === "estimated" && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Sparkles className="h-3 w-3" /> Estimado
                          </Badge>
                        )}
                        {source === "no_history" && (
                          <Badge variant="outline" className="gap-1 text-[10px] text-warning">
                            <AlertTriangle className="h-3 w-3" /> Sem histórico
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {distribution > 0 ? (
                        <span className="font-medium text-success">{formatBRL(distribution)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {dec ? (
                        <Badge variant="outline" className={`gap-1 ${dec.tone}`}>
                          <dec.icon className="h-3 w-3" /> {dec.label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canDecide && (
                        <Button size="sm" variant={dec ? "outline" : "default"} onClick={() => openDialog(row)}>
                          {dec ? "Alterar" : "Registrar"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decisão de distribuição</DialogTitle>
            <DialogDescription>
              {openRow && (hotelById.get(openRow.hotel_id)?.name ?? openRow.hotel_id)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={decision === "enviado" ? "default" : "outline"}
                size="sm"
                onClick={() => setDecision("enviado")}
                className="gap-1"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Enviado
              </Button>
              <Button
                variant={decision === "sem_distribuicao" ? "default" : "outline"}
                size="sm"
                onClick={() => setDecision("sem_distribuicao")}
                className="gap-1"
              >
                <XCircle className="h-3.5 w-3.5" /> Sem dist.
              </Button>
              <Button
                variant={decision === "pendente" ? "default" : "outline"}
                size="sm"
                onClick={() => setDecision("pendente")}
                className="gap-1"
              >
                <Clock className="h-3.5 w-3.5" /> Pendente
              </Button>
            </div>

            {decision === "enviado" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider">Valor enviado (R$)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={valueStr}
                  onChange={(e) => setValueStr(e.target.value)}
                  placeholder="0,00"
                />
              </div>
            )}

            {/* Métricas adicionais do fechamento (Bloco 4) */}
            {(() => {
              const finalValue =
                decision === "enviado"
                  ? Number((valueStr || "0").replace(",", "."))
                  : openRow?.final_distribution ?? openRow?.estimated_distribution ?? 0;
              const distribPorUh =
                metrics?.uhsDisponiveis && metrics.uhsDisponiveis > 0 && finalValue
                  ? finalValue / metrics.uhsDisponiveis
                  : null;
              return (
                <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Distribuição / UH
                    </p>
                    <p className="text-sm font-semibold">
                      {distribPorUh != null ? formatBRL(distribPorUh) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Taxa Fee (Falcon s/ Receita)
                    </p>
                    <p className="text-sm font-semibold">
                      {metrics?.taxaFee != null ? formatBRL(metrics.taxaFee) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Taxa de Sucesso
                    </p>
                    <p className="text-sm font-semibold">
                      {metrics?.taxaSucesso != null ? formatBRL(metrics.taxaSucesso) : "—"}
                    </p>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider">Observações</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenRow(null)}>Cancelar</Button>
            <Button onClick={submit} disabled={record.isPending}>
              {record.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}