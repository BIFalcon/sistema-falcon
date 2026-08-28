import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Download, Link2, Loader2, Search } from "lucide-react";
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

export interface BoxAction {
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onRun: (rows: ReconcileRow[]) => void;
}

export interface BoxConfig {
  key: string;
  title: string;
  subtitle?: string;
  rows: ReconcileRow[];
  /** Lado da equação da conciliação. */
  position: "left" | "right";
  actions?: BoxAction[];
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

type SortState = { field: "date" | "amount"; dir: "asc" | "desc" };

function sheetRows(rows: ReconcileRow[]) {
  return rows.map((r) => ({
    Data: fmtDay(r.date),
    Descrição: r.title,
    Detalhe: r.subtitle ?? "",
    Categoria: r.tag ?? "",
    Valor: r.amount,
  }));
}

function exportRows(rows: ReconcileRow[], fileName: string, extraSummary?: Record<string, number>) {
  const data: Record<string, string | number | null>[] = sheetRows(rows);
  if (extraSummary) {
    data.push({ Data: "", Descrição: "", Detalhe: "", Categoria: "", Valor: null });
    for (const [k, v] of Object.entries(extraSummary)) {
      data.push({ Data: "", Descrição: k, Detalhe: "", Categoria: "", Valor: v });
    }
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conciliação");
  XLSX.writeFile(wb, fileName);
}

/** Exporta todos os quadros da tela num único arquivo, uma aba por quadro. */
function exportBoxes(boxes: { title: string; rows: ReconcileRow[] }[], fileName: string) {
  const wb = XLSX.utils.book_new();
  for (const b of boxes) {
    const rows = sheetRows(b.rows);
    const total = b.rows.reduce((s, r) => s + r.amount, 0);
    rows.push({ Data: "", Descrição: "TOTAL", Detalhe: "", Categoria: "", Valor: total });
    const name = b.title.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Quadro";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  XLSX.writeFile(wb, fileName);
}

function SortHeader({ sort, onSort }: { sort: SortState; onSort: (s: SortState) => void }) {
  const btn = (field: SortState["field"], label: string) => {
    const active = sort.field === field;
    return (
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors",
          active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() =>
          onSort({ field, dir: active && sort.dir === "desc" ? "asc" : "desc" })
        }
      >
        {label}
        {active && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide">
      <span className="text-muted-foreground">Ordenar:</span>
      {btn("date", "Data")}
      {btn("amount", "Valor")}
    </div>
  );
}

function SideBox({
  box,
  selected,
  onToggle,
  onToggleAll,
  search,
  onSearch,
  sort,
  onSort,
  onClearSelection,
}: {
  box: BoxConfig;
  selected: Set<string>;
  onToggle: (row: ReconcileRow) => void;
  onToggleAll: (rows: ReconcileRow[], checked: boolean) => void;
  search: string;
  onSearch: (v: string) => void;
  sort: SortState;
  onSort: (s: SortState) => void;
  onClearSelection: () => void;
}) {
  const rows = box.rows;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const pickedRows = rows.filter((r) => selected.has(r.id));
  const selTotal = pickedRows.reduce((s, r) => s + r.amount, 0);
  const allChecked = rows.length > 0 && pickedRows.length === rows.length;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{box.title}</CardTitle>
            {box.subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{box.subtitle}</p>}
          </div>
          <Badge variant="outline" className="text-[10px]">
            {box.position === "left" ? "Lado esquerdo" : "Lado direito"}
          </Badge>
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
        {(box.actions ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(box.actions ?? []).map((a) => (
              <Button
                key={a.label}
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                disabled={a.disabled || pickedRows.length === 0}
                onClick={() => {
                  a.onRun(pickedRows);
                  onClearSelection();
                }}
              >
                {a.icon}
                {a.label}
                {pickedRows.length > 0 ? ` (${pickedRows.length})` : ""}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox checked={allChecked} onCheckedChange={(v) => onToggleAll(rows, !!v)} />
            Selecionar todos
          </label>
          <SortHeader sort={sort} onSort={onSort} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{rows.length} lançamento(s)</span>
          <span>
            Total: <Money value={total} />
            {pickedRows.length > 0 && (
              <>
                {" "}· Selecionado: <Money value={selTotal} />
              </>
            )}
          </span>
        </div>
      </CardHeader>
      {/* Rolagem interna própria por quadro */}
      <CardContent className="p-0 max-h-[460px] overflow-y-auto">
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
  boxes,
  onReconcile,
  isReconciling,
  exportName,
}: {
  boxes: BoxConfig[];
  onReconcile: (left: ReconcileRow[], right: ReconcileRow[]) => void;
  isReconciling: boolean;
  exportName: string;
}) {
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [sorts, setSorts] = useState<Record<string, SortState>>({});

  const getSel = (key: string) => selection[key] ?? new Set<string>();
  const getSort = (key: string): SortState => sorts[key] ?? { field: "date", dir: "asc" };

  const visible = useMemo(
    () =>
      boxes.map((b) => {
        const term = (searches[b.key] ?? "").trim().toLowerCase();
        let rows = term
          ? b.rows.filter((r) =>
              [r.title, r.subtitle, r.tag, r.date, String(r.amount)]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(term)),
            )
          : b.rows;
        const s = getSort(b.key);
        rows = [...rows].sort((a, c) => {
          const cmp =
            s.field === "amount"
              ? a.amount - c.amount
              : String(a.date ?? "").localeCompare(String(c.date ?? ""));
          return s.dir === "asc" ? cmp : -cmp;
        });
        return { ...b, rows };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxes, searches, sorts],
  );

  const pickedByBox = visible.map((b) => ({
    box: b,
    picked: b.rows.filter((r) => getSel(b.key).has(r.id)),
  }));

  const leftPicked = pickedByBox.filter((p) => p.box.position === "left").flatMap((p) => p.picked);
  const rightPicked = pickedByBox.filter((p) => p.box.position === "right").flatMap((p) => p.picked);
  const leftTotal = leftPicked.reduce((s, r) => s + r.amount, 0);
  const rightTotal = rightPicked.reduce((s, r) => s + r.amount, 0);
  const diff = leftTotal - rightTotal;
  const zeroDiff = Math.abs(diff) < 0.01;
  // Regra: só concilia quando os dois lados batem exatamente.
  const canReconcile = leftPicked.length > 0 && rightPicked.length > 0 && zeroDiff;

  const toggle = (key: string, row: ReconcileRow) =>
    setSelection((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return { ...prev, [key]: next };
    });

  const toggleAll = (key: string, rows: ReconcileRow[], checked: boolean) =>
    setSelection((prev) => ({ ...prev, [key]: checked ? new Set(rows.map((r) => r.id)) : new Set() }));

  const clearBox = (key: string) => setSelection((prev) => ({ ...prev, [key]: new Set() }));
  const clearAll = () => setSelection({});

  const cols = visible.length >= 3 ? "xl:grid-cols-3" : "lg:grid-cols-2";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => exportBoxes(visible.map((b) => ({ title: b.title, rows: b.rows })), exportName)}
        >
          <Download className="h-3 w-3 mr-1" /> Exportar tudo (Excel)
        </Button>
      </div>

      <div className={cn("grid gap-4", cols)}>
        {visible.map((b) => (
          <SideBox
            key={b.key}
            box={b}
            selected={getSel(b.key)}
            onToggle={(r) => toggle(b.key, r)}
            onToggleAll={(rows, checked) => toggleAll(b.key, rows, checked)}
            search={searches[b.key] ?? ""}
            onSearch={(v) => setSearches((prev) => ({ ...prev, [b.key]: v }))}
            sort={getSort(b.key)}
            onSort={(s) => setSorts((prev) => ({ ...prev, [b.key]: s }))}
            onClearSelection={() => clearBox(b.key)}
          />
        ))}
      </div>

      <Card className={cn("border-2", canReconcile ? "border-emerald-500/60" : "border-border")}>
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <span>
              Esquerda: <Money value={leftTotal} />{" "}
              <span className="text-muted-foreground">({leftPicked.length})</span>
            </span>
            <span>
              Direita: <Money value={rightTotal} />{" "}
              <span className="text-muted-foreground">({rightPicked.length})</span>
            </span>
            <span className="font-semibold">
              Diferença:{" "}
              <span className={cn("tabular-nums", zeroDiff ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                {diff < 0 ? "-" : ""}{fmtBRL(Math.abs(diff))}
              </span>
            </span>
            {!zeroDiff && (leftPicked.length > 0 || rightPicked.length > 0) && (
              <span className="text-[11px] text-destructive">
                Só é possível conciliar com diferença zero.
              </span>
            )}
          </div>
          <Button
            size="sm"
            disabled={!canReconcile || isReconciling}
            onClick={() => {
              onReconcile(leftPicked, rightPicked);
              clearAll();
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

export { exportRows, exportBoxes, fmtDay };
