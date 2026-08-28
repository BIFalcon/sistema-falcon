import { useState } from "react";
import * as XLSX from "xlsx";
import { Download, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";
import { Money, fmtDay, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import type { ConcMatch } from "@/hooks/useConciliacaoCartao";

const SIDE_LABEL: Record<string, string> = {
  opera: "Front Caixa (Opera)",
  acquirer: "Operadora (Adquirente)",
  bank: "Extrato Bancário",
};

/** Conciliados: mostra os dois lados da equação, com desfazer individual ou em lote. */
export function ConciliadosPairs({
  matches, rowById, title, leftSides, exportName, onUndoMany, undoing,
}: {
  matches: ConcMatch[];
  rowById: Map<string, ReconcileRow>;
  title: string;
  leftSides: string[];
  exportName: string;
  onUndoMany: (matches: ConcMatch[]) => void;
  undoing: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groups = matches.map((m) => {
    const items = m.conc_match_items.map((i) => ({
      side: i.side as string,
      amount: Number(i.amount),
      row: rowById.get(i.entry_id),
    }));
    return {
      match: m,
      left: items.filter((i) => leftSides.includes(i.side)),
      right: items.filter((i) => !leftSides.includes(i.side)),
    };
  });

  const leftSum = groups.reduce((s, g) => s + g.left.reduce((a, i) => a + i.amount, 0), 0);
  const rightSum = groups.reduce((s, g) => s + g.right.reduce((a, i) => a + i.amount, 0), 0);
  const allChecked = groups.length > 0 && selected.size === groups.length;

  const handleExport = () => {
    const data: Record<string, string | number>[] = [];
    groups.forEach((g, idx) => {
      const all = [...g.left.map((i) => ({ ...i, pos: "Esquerda" })), ...g.right.map((i) => ({ ...i, pos: "Direita" }))];
      for (const i of all) {
        data.push({
          "Conciliação": idx + 1,
          "Conciliado em": fmtDateTime(g.match.matched_at),
          Lado: i.pos,
          Origem: SIDE_LABEL[i.side] ?? i.side,
          Data: fmtDay(i.row?.date ?? null),
          Descrição: i.row?.title ?? "(lançamento fora do período/filtro)",
          Detalhe: i.row?.subtitle ?? "",
          Valor: i.amount,
        });
      }
    });
    data.push({
      "Conciliação": "TOTAL", "Conciliado em": "", Lado: "", Origem: "", Data: "",
      Descrição: `Esquerda ${fmtBRL(leftSum)} · Direita ${fmtBRL(rightSum)} · Diferença ${fmtBRL(leftSum - rightSum)}`,
      Detalhe: "", Valor: leftSum,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Conciliados");
    XLSX.writeFile(wb, exportName);
  };

  const ItemList = ({ items }: { items: { side: string; amount: number; row?: ReconcileRow }[] }) => (
    <ul className="space-y-1">
      {items.length === 0 && <li className="text-muted-foreground">—</li>}
      {items.map((i, k) => (
        <li key={k} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground tabular-nums">{fmtDay(i.row?.date ?? null)}</span>
              <span className="font-medium truncate">{i.row?.title ?? "(fora do filtro atual)"}</span>
            </div>
            {i.row?.subtitle && <p className="text-muted-foreground truncate">{i.row.subtitle}</p>}
            <Badge variant="outline" className="mt-0.5 text-[9px] px-1 py-0 h-4">{SIDE_LABEL[i.side] ?? i.side}</Badge>
          </div>
          <Money value={i.amount} />
        </li>
      ))}
    </ul>
  );

  return (
    <Card>
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {groups.length} conciliação(ões) · Esquerda <Money value={leftSum} /> · Direita <Money value={rightSum} /> · Diferença{" "}
              <span className="tabular-nums">{fmtBRL(leftSum - rightSum)}</span>
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" /> Exportar Excel
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox
              checked={allChecked}
              onCheckedChange={(v) => setSelected(v ? new Set(groups.map((g) => g.match.id)) : new Set())}
            />
            Selecionar todas
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={selected.size === 0 || undoing}
            onClick={() => {
              const list = groups.filter((g) => selected.has(g.match.id)).map((g) => g.match);
              onUndoMany(list);
              setSelected(new Set());
            }}
          >
            <Undo2 className="h-3 w-3 mr-1" /> Desfazer selecionadas ({selected.size})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 max-h-[620px] overflow-y-auto">
        {groups.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nada conciliado ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => {
              const l = g.left.reduce((s, i) => s + i.amount, 0);
              const r = g.right.reduce((s, i) => s + i.amount, 0);
              return (
                <li key={g.match.id} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Checkbox
                        checked={selected.has(g.match.id)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(g.match.id);
                            else next.delete(g.match.id);
                            return next;
                          })
                        }
                      />
                      {fmtDateTime(g.match.matched_at)}
                      {g.match.note ? ` · ${g.match.note}` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <span>Diferença: <span className="tabular-nums">{fmtBRL(l - r)}</span></span>
                      <Button
                        variant="ghost" size="sm" className="h-6 text-[11px]"
                        disabled={undoing}
                        onClick={() => onUndoMany([g.match])}
                      >
                        <Undo2 className="h-3 w-3 mr-1" /> Desfazer
                      </Button>
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 text-[11px]">
                    <div className="rounded-md border p-2">
                      <p className="mb-1 font-semibold">Lado esquerdo · <Money value={l} /></p>
                      <ItemList items={g.left} />
                    </div>
                    <div className="rounded-md border p-2">
                      <p className="mb-1 font-semibold">Lado direito · <Money value={r} /></p>
                      <ItemList items={g.right} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
