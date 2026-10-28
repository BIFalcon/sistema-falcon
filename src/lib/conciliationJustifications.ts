import type { ConcJustification, ConcKind } from "@/hooks/useConciliacaoCartao";
import type { ReconcileRow } from "@/components/conciliacao/ReconcilePanel";

export function referenceMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return { from: "", to: "" };
  const [year, number] = month.split("-").map(Number);
  if (number < 1 || number > 12) return { from: "", to: "" };
  const last = new Date(year, number, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}

export function filterJustificationRows(rows: ReconcileRow[], search: string, from: string, to: string) {
  const term = search.trim().toLowerCase();
  return rows.filter(row => {
    const date = row.date?.slice(0, 10);
    if ((from || to) && !date) return false;
    if (date && ((from && date < from) || (to && date > to))) return false;
    return !term || [row.title, row.subtitle, row.tag, row.date, String(row.amount)]
      .filter(Boolean).some(value => String(value).toLowerCase().includes(term));
  });
}

export function justificationSheetRows(rows: ReconcileRow[], notes: ConcJustification[], kind?: ConcKind) {
  const latest = new Map<string, ConcJustification>();
  for (const note of notes) {
    if (note.kind !== kind) continue;
    const key = `${note.side}:${note.entry_id}`;
    const previous = latest.get(key);
    if (!previous || note.updated_at > previous.updated_at) latest.set(key, note);
  }
  return rows.map(row => ({
    Data: row.date ? row.date.slice(0, 10).split("-").reverse().join("/") : "—",
    Descrição: row.title,
    Detalhe: row.subtitle ?? "",
    Categoria: row.tag ?? "",
    Origem: row.origin ?? "",
    Valor: row.amount,
    Justificativa: latest.get(`${row.side}:${row.id}`)?.note ?? "",
  }));
}