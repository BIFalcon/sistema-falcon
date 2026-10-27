import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateClosingStatus } from "@/hooks/useClosings";
import { useRecordApproval } from "@/hooks/useApprovals";
import {
  type ClosingStatus,
  type ClosingStage,
  type AppRole,
  STATUS_LABELS,
  DRE_NEXT_STATUS,
  DRE_PREV_STATUS,
  DRE_STAGE_APPROVER,
  CARTA_NEXT_STATUS,
  CARTA_PREV_STATUS,
  CARTA_STAGE_APPROVER,
} from "@/lib/constants";
import { canActOnStage, STAGE_OWNER_LABEL } from "@/lib/closingStageAccess";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  closingId: string;
  stage: ClosingStage; // "dre" | "carta"
  currentStatus: ClosingStatus;
  onChanged?: () => void;
}

/**
 * Botões de Aprovar e Devolver para o estágio atual.
 * - "Aprovar" avança o status_dre conforme DRE_NEXT_STATUS.
 * - "Devolver" retorna para o estágio anterior, exigindo nota.
 * - Verifica role do usuário antes de habilitar.
 */
export function ApprovalActions({ closingId, stage, currentStatus, onChanged }: Props) {
  const { user, roles, isMaster, isFernandoCEO } = useAuth();
  const updateStatus = useUpdateClosingStatus();
  const recordApproval = useRecordApproval();

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");

  const isCarta = stage === "carta";
  const APPROVER = isCarta ? CARTA_STAGE_APPROVER : DRE_STAGE_APPROVER;
  const NEXT = isCarta ? CARTA_NEXT_STATUS : DRE_NEXT_STATUS;
  const PREV = isCarta ? CARTA_PREV_STATUS : DRE_PREV_STATUS;
  const FIELD = isCarta ? "status_carta" : "status_dre";

  const requiredRole = APPROVER[currentStatus];
  void isMaster;
  const canApprove = canActOnStage(isCarta ? "carta" : "dre", currentStatus, roles, isFernandoCEO);
  const waitingFor = STAGE_OWNER_LABEL[currentStatus];

  const nextStatus = NEXT[currentStatus];
  const prevStatus = PREV[currentStatus];

  async function handleApprove() {
    if (!user || !nextStatus) return;
    try {
      await recordApproval.mutateAsync({
        closingId,
        stage,
        status: nextStatus,
        userId: user.id,
      });
      await updateStatus.mutateAsync({
        closingId,
        field: FIELD,
        value: nextStatus,
      });
      toast.success(`Avançado para "${STATUS_LABELS[nextStatus]}"`);
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar");
    }
  }

  async function handleReturn() {
    if (!user) return;
    if (!returnNote.trim()) {
      toast.error("Comentário obrigatório para devolução");
      return;
    }
    try {
      await recordApproval.mutateAsync({
        closingId,
        stage,
        status: "devolvido",
        notes: returnNote.trim(),
        userId: user.id,
      });
      await updateStatus.mutateAsync({
        closingId,
        field: FIELD,
        value: prevStatus ?? "devolvido",
      });
      toast.success(`${isCarta ? "Carta" : "DRE"} devolvida ao estágio anterior`);
      setReturnOpen(false);
      setReturnNote("");
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao devolver");
    }
  }

  // DRE aprovada: só Fernando ou Master podem devolver (reabre o envio de nova versão).
  const canUnapprove = !isCarta && currentStatus === "aprovado" && (isMaster || roles.includes("fernando" as AppRole));
  if ((currentStatus === "aprovado" && !canUnapprove) || currentStatus === "nao_iniciado" || currentStatus === "nao_aplicavel") {
    return currentStatus === "aprovado" && !isCarta ? (
      <p className="text-xs text-muted-foreground">DRE aprovada. Somente Fernando ou Master podem devolvê-la.</p>
    ) : null;
  }
  const showApprove = !!nextStatus && currentStatus !== "aprovado";
  const canReturn = canApprove || canUnapprove;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showApprove && (
          <Gate blocked={!canApprove} label={waitingFor}>
            <Button
              onClick={handleApprove}
              disabled={!canApprove || updateStatus.isPending || recordApproval.isPending}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Aprovar
            </Button>
          </Gate>
        )}
        {prevStatus && (
          <Gate blocked={!canReturn} label={waitingFor}>
            <Button
              variant="outline"
              onClick={() => setReturnOpen(true)}
              disabled={!canReturn}
              className="gap-2"
            >
              <Undo2 className="h-4 w-4" />
              Devolver
            </Button>
          </Gate>
        )}
      </div>

      {!canApprove && !canUnapprove && requiredRole && (
        <p className="text-xs text-muted-foreground mt-2">
          Esta etapa ainda não está com você{waitingFor ? <> — aguardando <strong>{waitingFor}</strong></> : null}.
        </p>
      )}

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver {isCarta ? "Carta" : "DRE"}</DialogTitle>
            <DialogDescription>
              {isCarta ? "A Carta" : "A DRE"} retornará para <strong>{prevStatus && STATUS_LABELS[prevStatus]}</strong>. O comentário é obrigatório e ficará registrado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="return-note">Motivo da devolução</Label>
            <Textarea
              id="return-note"
              rows={4}
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              placeholder="Descreva o motivo…"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={handleReturn}
              disabled={!returnNote.trim() || updateStatus.isPending || recordApproval.isPending}
            >
              Confirmar devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Gate({ blocked, label, children }: { blocked: boolean; label?: string; children: ReactNode }) {
  if (!blocked || !label) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}>{children}</span></TooltipTrigger>
        <TooltipContent>Aguardando {label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
