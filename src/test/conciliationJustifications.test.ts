import { describe, it, expect } from "vitest";
import { filterJustificationRows, referenceMonthRange, justificationSheetRows } from "@/lib/conciliationJustifications";
import type { ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import type { ConcJustification } from "@/hooks/useConciliacaoCartao";

const rows: ReconcileRow[] = [
  { id: "1", side: "opera", date: "2026-10-01", title: "Reserva", amount: 10 },
  { id: "2", side: "opera", date: "2026-10-28", title: "Reserva", amount: 20 },
  { id: "3", side: "bank", date: "2026-11-01", title: "Depósito", amount: 30 },
  { id: "4", side: "bank", date: null, title: "Sem data", amount: 40 },
];
const note = (overrides: Partial<ConcJustification> = {}): ConcJustification => ({
  id: "j", hotel_id: "hotel", entry_id: "1", side: "opera", kind: "cartao", note: "Comprovante pendente",
  author_id: "user", created_at: "2026-10-01", updated_at: "2026-10-01", ...overrides,
});
describe("Justificativas financeiras", () => {
  it("inclui ambas as datas-limite do período e mantém a busca textual", () => {
    expect(filterJustificationRows(rows, "reserva", "2026-10-01", "2026-10-28").map(r => r.id)).toEqual(["1", "2"]);
    expect(filterJustificationRows(rows, "depósito", "2026-10-01", "2026-10-28")).toEqual([]);
  });
  it("mês de referência cobre o mês completo", () => {
    expect(referenceMonthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(referenceMonthRange("2024-02").to).toBe("2024-02-29");
    const range = referenceMonthRange("2026-10");
    expect(filterJustificationRows(rows, "", range.from, range.to).map(r => r.id)).toEqual(["1", "2"]);
  });
  it("limpar período recupera lançamentos sem data; período invertido não inclui itens", () => {
    expect(filterJustificationRows(rows, "", "", "")).toHaveLength(4);
    expect(filterJustificationRows(rows, "", "2026-10-28", "2026-10-01")).toEqual([]);
  });
  it("Excel associa texto salvo ao lançamento, origem e modalidade corretos", () => {
    const notes = [note(), note({ side: "bank", note: "Outra origem" }), note({ kind: "pix_extrato", note: "Outro fluxo" }),
      note({ updated_at: "2026-10-28", note: "Texto atualizado" })];
    expect(justificationSheetRows(rows, notes, "cartao").map(r => r.Justificativa)).toEqual(["Texto atualizado", "", "", ""]);
    expect(justificationSheetRows([{ ...rows[0], side: "bank" }], notes, "cartao")[0].Justificativa).toBe("Outra origem");
  });
});