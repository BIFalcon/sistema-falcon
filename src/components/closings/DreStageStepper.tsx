import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClosingStatus } from "@/lib/constants";

const STEPS: { key: ClosingStatus; label: string }[] = [
  { key: "aguardando_comentarios", label: "Comentários" },
  { key: "aguardando_controladoria", label: "Controladoria" },
  { key: "aguardando_gop", label: "GOP" },
  { key: "aguardando_fernando", label: "Fernando" },
  { key: "aprovado", label: "Aprovado" },
];

function indexOf(status: ClosingStatus): number {
  const i = STEPS.findIndex((s) => s.key === status);
  if (i >= 0) return i;
  if (status === "nao_iniciado") return -1;
  if (status === "devolvido") return 0;
  return -1;
}

interface Props {
  status: ClosingStatus;
}

export function DreStageStepper({ status }: Props) {
  const current = indexOf(status);
  const isReturned = status === "devolvido";

  return (
    <ol className="flex items-center gap-1 sm:gap-2 w-full overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = i < current || status === "aprovado";
        const active = i === current && status !== "aprovado";
        return (
          <li key={step.key} className="flex items-center gap-1 sm:gap-2 shrink-0">
            <div
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors",
                done && "bg-success text-success-foreground border-success",
                active && !isReturned && "bg-primary text-primary-foreground border-primary",
                active && isReturned && "bg-destructive text-destructive-foreground border-destructive",
                !done && !active && "bg-card text-muted-foreground border-border",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-xs font-medium whitespace-nowrap",
                done ? "text-success" : active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn("w-4 sm:w-8 h-px", done ? "bg-success" : "bg-border")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}