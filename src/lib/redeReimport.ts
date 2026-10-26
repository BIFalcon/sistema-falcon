import type { AcquirerRow } from "./conciliacaoParsers";

export interface ExistingAcquirerEntry {
  id: string;
  entry_key: string;
  nsu: string | null;
  bandeira: string | null;
  amount: number;
  created_at?: string | null;
}

export interface DeltaRow extends AcquirerRow {
  adjusts_entry_id: string;
}

const nsuKey = (nsu: string | null | undefined, bandeira: string | null | undefined) => {
  const n = String(nsu ?? "").trim();
  if (!n) return null;
  return `${n}|${String(bandeira ?? "").trim().toUpperCase()}`;
};

/**
 * Reimportação da Rede (janela de 30 dias): para cada NSU+bandeira já gravado,
 * compara o valor atual do arquivo com a soma do que já existe (original + ajustes).
 * Se mudou, gera uma linha de ajuste com a diferença; a linha original nunca é alterada.
 */
export function splitRedeReimport(
  parsed: AcquirerRow[],
  existing: ExistingAcquirerEntry[],
): { newRows: AcquirerRow[]; deltaRows: DeltaRow[]; unchanged: AcquirerRow[] } {
  const knownKeys = new Set(existing.map((e) => e.entry_key));
  const groups = new Map<string, { sum: number; originalId: string; originalCreated: string }>();
  for (const e of existing) {
    const k = nsuKey(e.nsu, e.bandeira);
    if (!k) continue;
    const g = groups.get(k);
    const created = e.created_at ?? "";
    if (!g) groups.set(k, { sum: Number(e.amount), originalId: e.id, originalCreated: created });
    else {
      g.sum += Number(e.amount);
      if (created && created < g.originalCreated) { g.originalId = e.id; g.originalCreated = created; }
    }
  }

  const newRows: AcquirerRow[] = [];
  const deltaRows: DeltaRow[] = [];
  const unchanged: AcquirerRow[] = [];
  const fileTotals = new Map<string, { total: number; row: AcquirerRow }>();

  for (const r of parsed) {
    const k = r.source === "rede" ? nsuKey(r.nsu, r.bandeira) : null;
    if (k && groups.has(k)) {
      const t = fileTotals.get(k);
      if (t) t.total += r.amount;
      else fileTotals.set(k, { total: r.amount, row: r });
      continue;
    }
    if (knownKeys.has(r.entry_key)) unchanged.push(r);
    else newRows.push(r);
  }

  for (const [k, { total, row }] of fileTotals) {
    const g = groups.get(k);
    if (!g) continue;
    const delta = Math.round((total - g.sum) * 100) / 100;
    if (Math.abs(delta) < 0.005) { unchanged.push(row); continue; }
    deltaRows.push({
      ...row,
      amount: delta,
      sale_date: row.data_cancelamento || row.sale_date,
      entry_key: `rede-adj|${row.hotel_id}|${k}|${total.toFixed(2)}`,
      status: `Ajuste NSU (${delta < 0 ? "estorno" : "acréscimo"})`,
      valor_liquido: null,
      valor_original: null,
      adjusts_entry_id: g.originalId,
    });
  }

  return { newRows, deltaRows, unchanged };
}
