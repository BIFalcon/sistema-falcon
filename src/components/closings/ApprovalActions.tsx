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
  const { user, roles, isMaster } = useAuth();
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
  const canApprove =
    isMaster ||
    (!isCarta && currentStatus === "aguardando_comentarios" &&
      (roles.includes("gg" as AppRole) || roles.includes("gop" as AppRole))) ||
    (requiredRole !== null && roles.includes(requiredRole));

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

  if (currentStatus === "aprovado" || currentStatus === "nao_iniciado" || currentStatus === "nao_aplicavel") {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {nextStatus && (
          <Button
            onClick={handleApprove}
            disabled={!canApprove || updateStatus.isPending || recordApproval.isPending}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {currentStatus === "aguardando_fernando" ? "Aprovação Final" : `Aprovar — ${STATUS_LABELS[nextStatus]}`}
          </Button>
        )}
        {prevStatus && (
          <Button
            variant="outline"
            onClick={() => setReturnOpen(true)}
            disabled={!canApprove}
            className="gap-2"
          >
            <Undo2 className="h-4 w-4" />
            Devolver
          </Button>
        )}
      </div>

      {!canApprove && requiredRole && (
        <p className="text-xs text-muted-foreground mt-2">
          Apenas usuários com papel <strong>{STATUS_LABELS[currentStatus]}</strong> podem aprovar este estágio.
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