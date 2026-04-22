import { Check } from "lucide-react";
import type { ClosingStatus } from "@/lib/constants";

const STAGES: { status: ClosingStatus; label: string }[] = [
  { status: "nao_iniciado", label: "Não iniciado" },
  { status: "aguardando_gg", label: "Aguardando GG" },
  { status: "aguardando_fernando", label: "Aguardando Fernando" },
  { status: "aprovado", label: "Aprovado" },
];

export function CartaStageStepper({ status }: { status: ClosingStatus }) {
  if (status === "nao_aplicavel") {
    return (
      <div className="text-sm text-muted-foreground italic">
        Este hotel não envia Carta ao Investidor — fluxo segue direto para o Financeiro.
      </div>
    );
  }
  const idx = STAGES.findIndex((s) => s.status === status);
  return (
    <ol className="flex items-center gap-2">
      {STAGES.map((s, i) => {
        const done = idx > i || status === "aprovado";
        const active = idx === i;
        return (
          <li key={s.status} className="flex items-center gap-2">
            <div
              className={[
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border",
                done ? "bg-accent text-accent-foreground border-accent" :
                active ? "bg-primary text-primary-foreground border-primary" :
                "bg-secondary text-muted-foreground border-border",
              ].join(" ")}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={["text-xs", active ? "font-semibold text-foreground" : "text-muted-foreground"].join(" ")}>
              {s.label}
            </span>
            {i < STAGES.length - 1 && <span className="w-6 h-px bg-border mx-1" />}
          </li>
        );
      })}
    </ol>
  );
}