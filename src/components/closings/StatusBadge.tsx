import { cn } from "@/lib/utils";
import { STATUS_LABELS, STATUS_TONE, type ClosingStatus } from "@/lib/constants";

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-primary/10 text-primary",
  pending: "bg-warning/15 text-warning-foreground border border-warning/40",
  approved: "bg-success/15 text-success border border-success/30",
  returned: "bg-destructive/10 text-destructive border border-destructive/30",
};

interface Props {
  status: ClosingStatus;
  className?: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, className, size = "sm" }: Props) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}