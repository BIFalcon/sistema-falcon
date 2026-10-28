import { useId, useMemo, useState } from "react";
import { MessageSquarePlus, Save, Search, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { BrDateInput } from "@/components/ui/br-date-input";
import { filterJustificationRows, referenceMonthRange } from "@/lib/conciliationJustifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Money, fmtDay, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import type { ConcJustification, ConcKind } from "@/hooks/useConciliacaoCartao";

/**
 * Espaço de justificativa para GG e Admin: apenas observação em texto
 * vinculada a um lançamento pendente. Nada de upload nem conciliação.
 */
export function JustificationsPanel({
  rows,
  justifications,
  kind,
  onSave,
  saving,
  dateFrom,
  dateTo,
  onChangeRange,
}: {
  rows: ReconcileRow[];
  justifications: ConcJustification[];
  kind: ConcKind;
  onSave: (row: ReconcileRow, note: string) => void;
  saving: boolean;
  dateFrom?: string;
  dateTo?: string;
  onChangeRange?: (from: string, to: string) => void;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const from = dateFrom ?? localFrom;
  const to = dateTo ?? localTo;
  const monthRange = referenceMonthRange(from.slice(0, 7));
  const month = from && from === monthRange.from && to === monthRange.to ? from.slice(0, 7) : "";
  const changeRange = (nextFrom: string, nextTo: string) => {
    setLocalFrom(nextFrom);
    setLocalTo(nextTo);
    onChangeRange?.(nextFrom, nextTo);
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const byEntry = useMemo(() => {
    const m = new Map<string, ConcJustification>();
    for (const j of justifications) {
      const key = `${j.side}:${j.entry_id}`;
      if (j.kind === kind && !m.has(key)) m.set(key, j);
    }
    return m;
  }, [justifications, kind]);

  const visible = useMemo(() => filterJustificationRows(rows, search, from, to), [rows, search, from, to]);

  return (
    <Card>
      <CardHeader className="pb-3 space-y-2">
        <div>
          <CardTitle className="text-sm">Justificativas de itens pendentes</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Gerente Geral e Admin podem registrar observações sobre lançamentos ainda não conciliados.
            Não é possível anexar arquivos nem conciliar por aqui.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 w-40">
            <Label htmlFor={`${id}-month`} className="text-xs">Mês de referência</Label>
            <Input id={`${id}-month`} type="month" value={month} className="h-8 text-xs"
              onChange={e => { const range = referenceMonthRange(e.target.value); changeRange(range.from, range.to); }} />
          </div>
          <div className="space-y-1 w-36">
            <Label htmlFor={`${id}-from`} className="text-xs">Data inicial</Label>
            <BrDateInput id={`${id}-from`} value={from} onChange={value => changeRange(value, to)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1 w-36">
            <Label htmlFor={`${id}-to`} className="text-xs">Data final</Label>
            <BrDateInput id={`${id}-to`} value={to} onChange={value => changeRange(from, value)} className="h-8 text-xs" />
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSearch(""); changeRange("", ""); }}>
            <X className="mr-1 h-3.5 w-3.5" />Limpar filtros
          </Button>
        </div>
        {from && to && from > to && <p role="alert" className="text-xs text-destructive">A data final deve ser igual ou posterior à data inicial.</p>}
        <div className="relative max-w-[320px]">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lançamento…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0 max-h-[560px] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nenhum lançamento pendente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => {
              const j = byEntry.get(`${r.side}:${r.id}`);
              const open = openId === r.id;
              return (
                <li key={r.id} className="p-3 space-y-2 text-[11px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground tabular-nums">{fmtDay(r.date)}</span>
                        <span className="font-medium truncate">{r.title}</span>
                      </div>
                      {r.subtitle && <p className="text-muted-foreground truncate">{r.subtitle}</p>}
                      {j && (
                        <p className="mt-1 rounded-md bg-muted/60 p-2 text-foreground">
                          <Badge variant="outline" className="mr-1 text-[9px] px-1 py-0 h-4">Justificativa</Badge>
                          {j.note}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money value={r.amount} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          setOpenId(open ? null : r.id);
                          setDraft(j?.note ?? "");
                        }}
                      >
                        <MessageSquarePlus className="h-3 w-3 mr-1" />
                        {j ? "Editar" : "Justificar"}
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <div className="space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        placeholder="Descreva o motivo da pendência…"
                        className="text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setOpenId(null)}>
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={saving || !draft.trim()}
                          onClick={() => {
                            onSave(r, draft.trim());
                            setOpenId(null);
                          }}
                        >
                          <Save className="h-3 w-3 mr-1" /> Salvar
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
