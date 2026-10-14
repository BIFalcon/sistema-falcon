import { Badge } from "@/components/ui/badge";
import type { DataStatus } from "@/hooks/useInvestors";
import { STATUS_LABEL } from "@/hooks/useInvestors";

const CLS: Record<DataStatus, string> = {
  completo: "bg-success/15 text-success border-success/30",
  parcial: "bg-warning/15 text-warning-foreground border-warning/40",
  pendente: "bg-destructive/15 text-destructive border-destructive/30",
};

export function StatusSelo({ status }: { status: DataStatus }) {
  return <Badge variant="outline" className={CLS[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
