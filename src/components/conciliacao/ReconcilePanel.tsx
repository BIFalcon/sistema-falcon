import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Link2, Loader2, Search } from "lucide-react";
import { fmtBRL } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ConcSide } from "@/hooks/useConciliacaoCartao";

export interface ReconcileRow {
  id: string;
  side: ConcSide;
  date: string | null;
  amount: number;
  title: string;
  subtitle?: string;
  tag?: string;
  extra?: React.ReactNode;
}

export function Money({ value }: { value: number }) {
  const negative = value < 0;
  return (
    <span className={cn("tabular-nums font-medium", negative ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
      {negative ? "-" : ""}{fmtBRL(Math.abs(value))}
    </span>
  );
}

const fmtDay = (iso: string | null) =>
  iso ? iso.split("-").reverse().join("/") : "—";

function exportRows(rows: ReconcileRow[], fileName: string, extraSummary?: Record<string, number>) {
  const data = rows.map((r) => ({
    Data: fmtDay(r.date),
    Descrição: r.title,
    Detalhe: r.subtitle ?? "",
    Categoria: r.tag ?? "",
    Valor: r.amount,
  }));
  if (extraSummary) {
    data.push({ Data: "", Descrição: "", Detalhe: "", Categoria: "", Valor: null as never });
    for (const [k, v] of Object.entries(extraSummary)) {
      data.push({ Data: "", Descrição: k, Detalhe: "", Categoria: "", Valor: v });
    }
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conciliação");
  XLSX.writeFile(wb, fileName);
}

function SideBox({
  title,
  subtitle,
  rows,
  selected,
  onToggle,
  search,
  onSearch,
  onExport,
}: {
  title: string;
  subtitle?: string;
  rows: ReconcileRow[];
  selected: Set<string>;
  onToggle: (row: ReconcileRow) => void;
  search: string;
  onSearch: (v: string) => void;
  onExport: () => void;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const selTotal = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.amount, 0);

  return (
    <Card className="flex flex-col min-h-[420px]">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={onExport} className="h-7 text-[11px]">
            <Download className="h-3 w-3 mr-1" /> Excel
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{rows.length} lançamento(s)</span>
          <span>
            Total: <Money value={total} />
            {selected.size > 0 && (
              <>
                {" "}· Selecionado: <Money value={selTotal} />
              </>
            )}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">Nenhum lançamento pendente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex items-start gap-2 px-3 py-2 text-[11px] cursor-pointer hover:bg-muted/50",
                  selected.has(r.id) && "bg-primary/5",
                )}
                onClick={() => onToggle(r)}
              >
                <Checkbox checked={selected.has(r.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground tabular-nums">{fmtDay(r.date)}</span>
                    <span className="font-medium truncate">{r.title}</span>
                  </div>
                  {r.subtitle && <p className="text-muted-foreground truncate">{r.subtitle}</p>}
                  {r.tag && (
                    <Badge variant="outline" className="mt-1 text-[9px] px-1 py-0 h-4">{r.tag}</Badge>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money value={r.amount} />
                  {r.extra}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ReconcilePanel({
  leftTitle,
  leftSubtitle,
  rightTitle,
  rightSubtitle,
  leftRows,
  rightRows,
  onReconcile,
  isReconciling,
  exportPrefix,
}: {
  leftTitle: string;
  leftSubtitle?: string;
  rightTitle: string;
  rightSubtitle?: string;
  leftRows: ReconcileRow[];
  rightRows: ReconcileRow[];
  onReconcile: (left: ReconcileRow[], right: ReconcileRow[]) => void;
  isReconciling: boolean;
  exportPrefix: string;
}) {
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set());
  const [rightSel, setRightSel] = useState<Set<string>>(new Set());
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");

  const filter = (rows: ReconcileRow[], term: string) => {
    const t = term.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.title, r.subtitle, r.tag, r.date, String(r.amount)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  };

  const leftVisible = useMemo(() => filter(leftRows, leftSearch), [leftRows, leftSearch]);
  const rightVisible = useMemo(() => filter(rightRows, rightSearch), [rightRows, rightSearch]);

  const leftPicked = leftRows.filter((r) => leftSel.has(r.id));
  const rightPicked = rightRows.filter((r) => rightSel.has(r.id));
  const leftTotal = leftPicked.reduce((s, r) => s + r.amount, 0);
  const rightTotal = rightPicked.reduce((s, r) => s + r.amount, 0);
  const diff = leftTotal - rightTotal;
  const canReconcile = leftPicked.length > 0 && rightPicked.length > 0;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, row: ReconcileRow) => {
    const next = new Set(set);
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    setter(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SideBox
          title={leftTitle}
          subtitle={leftSubtitle}
          rows={leftVisible}
          selected={leftSel}
          onToggle={(r) => toggle(leftSel, setLeftSel, r)}
          search={leftSearch}
          onSearch={setLeftSearch}
          onExport={() => exportRows(leftVisible, `${exportPrefix}-esquerda.xlsx`)}
        />
        <SideBox
          title={rightTitle}
          subtitle={rightSubtitle}
          rows={rightVisible}
          selected={rightSel}
          onToggle={(r) => toggle(rightSel, setRightSel, r)}
          search={rightSearch}
          onSearch={setRightSearch}
          onExport={() => exportRows(rightVisible, `${exportPrefix}-direita.xlsx`)}
        />
      </div>

      <Card className={cn("border-2", canReconcile && Math.abs(diff) < 0.01 ? "border-emerald-500/60" : "border-border")}>
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <span>
              {leftTitle}: <Money value={leftTotal} />{" "}
              <span className="text-muted-foreground">({leftPicked.length})</span>
            </span>
            <span>
              {rightTitle}: <Money value={rightTotal} />{" "}
              <span className="text-muted-foreground">({rightPicked.length})</span>
            </span>
            <span className="font-semibold">
              Diferença:{" "}
              <span className={cn("tabular-nums", Math.abs(diff) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                {diff < 0 ? "-" : ""}{fmtBRL(Math.abs(diff))}
              </span>
            </span>
          </div>
          <Button
            size="sm"
            disabled={!canReconcile || isReconciling}
            onClick={() => {
              onReconcile(leftPicked, rightPicked);
              setLeftSel(new Set());
              setRightSel(new Set());
            }}
          >
            {isReconciling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Link2 className="h-3.5 w-3.5 mr-1" />}
            Conciliar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export { exportRows, fmtDay };
