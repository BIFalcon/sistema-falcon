import { SLA_HOURS } from "@/lib/constants";

export type SlaTone = "green" | "yellow" | "red" | "muted";

export interface StageSla {
  startedAt: string | null;
  approvedAt: string | null;
  hoursElapsed: number | null; // null when not finished
  slaHours: number;
  ratio: number | null; // hoursElapsed / slaHours
  tone: SlaTone;
  withinSla: boolean | null;
  overdueHours: number | null; // positive when over SLA
}

export function diffHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return Math.max(0, (e - s) / 36e5);
}

export function toneFromRatio(ratio: number | null): SlaTone {
  if (ratio == null) return "muted";
  if (ratio <= 1) return "green";
  if (ratio <= 1.2) return "yellow";
  return "red";
}

export function buildStageSla(
  startedAt: string | null,
  approvedAt: string | null,
  stage: "dre" | "carta",
  nowIso?: string,
): StageSla {
  const slaHours = SLA_HOURS[stage];
  const endRef = approvedAt ?? (startedAt ? (nowIso ?? new Date().toISOString()) : null);
  const hoursElapsed = diffHours(startedAt, endRef);
  const ratio = hoursElapsed != null ? hoursElapsed / slaHours : null;
  const tone = toneFromRatio(ratio);
  const withinSla = hoursElapsed == null ? null : hoursElapsed <= slaHours;
  const overdueHours = hoursElapsed != null && hoursElapsed > slaHours ? hoursElapsed - slaHours : null;
  return {
    startedAt,
    approvedAt,
    hoursElapsed,
    slaHours,
    ratio,
    tone,
    withinSla,
    overdueHours,
  };
}

export function formatHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function toneClass(tone: SlaTone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "yellow":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "red":
      return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function toneDotClass(tone: SlaTone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-500";
    case "red":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}