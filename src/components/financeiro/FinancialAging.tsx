import { fmtBRL } from "@/lib/formatters";

export function FinancialAging({ title, total, bands, unknown = 0 }: {
  title: string; total: number; bands: number[]; unknown?: number;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 min-w-0">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <p className="text-2xl font-semibold text-destructive mt-2 break-words">{fmtBRL(total)}</p>
      <dl className="grid grid-cols-3 gap-2 mt-4 border-t border-border pt-3">
        {["< 7 dias", "7 a 30 dias", "> 30 dias"].map((label, index) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xs font-semibold mt-1 break-words">{fmtBRL(bands[index] ?? 0)}</dd>
          </div>
        ))}
      </dl>
      {unknown !== 0 && <p className="text-xs text-muted-foreground mt-3">Sem data de referência: {fmtBRL(unknown)}</p>}
    </div>
  );
}