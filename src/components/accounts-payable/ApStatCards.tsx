/**
 * Componentes puramente visuais do módulo Contas a Pagar.
 * Não possuem estado próprio — são controlados pelo pai.
 */

// ── Stat ────────────────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}

export function Stat({ label, value, tone = "neutral" }: StatProps) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-lg font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}

// ── UrgencyCell ──────────────────────────────────────────────────────────────

type Tone = "danger" | "warning" | "amber" | "info" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
  amber: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  info: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
  muted: "bg-muted text-muted-foreground border-border",
};

interface UrgencyCellProps {
  label: string;
  count: number;
  tone: Tone;
  active?: boolean;
  onClick?: () => void;
}

export function UrgencyCell({ label, count, tone, active, onClick }: UrgencyCellProps) {
  const base =
    "rounded-md border px-2 py-2.5 text-center min-h-[72px] flex flex-col items-center justify-center gap-1 transition-all";
  const interactive = onClick ? "hover:shadow-soft hover:scale-[1.02] cursor-pointer" : "";
  const ring = active ? "ring-2 ring-offset-1 ring-current" : "";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${TONE_CLASSES[tone]} ${interactive} ${ring}`}
      >
        <p className="text-xl font-bold leading-none">{count}</p>
        <p className="text-[9px] uppercase tracking-wide leading-tight break-words w-full">{label}</p>
      </button>
    );
  }

  return (
    <div className={`${base} ${TONE_CLASSES[tone]} ${ring}`}>
      <p className="text-xl font-bold leading-none">{count}</p>
      <p className="text-[9px] uppercase tracking-wide leading-tight break-words w-full">{label}</p>
    </div>
  );
}
