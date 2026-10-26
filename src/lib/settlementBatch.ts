export interface BatchSale {
  payment_id: string;
  nsu: string | null;
  sale_date: string | null;
  gross: number | null;
  net: number | null;
  acquirer_id: string | null;
  status: string;
  opera: { id: string; date: string | null; amount: number; guest: string | null; room: string | null; receipt: string | null; category: string | null }[];
}
export interface SettlementBatch {
  source: string;
  id: string;
  label: string;
  date: string | null;
  amount: number;
  ready: boolean;
  complete: boolean;
  total: number;
  reconciled: number;
  net: number | null;
  reason: string;
  sales: BatchSale[];
}
export interface BatchDetails { batches: SettlementBatch[]; ambiguous?: boolean; transition?: boolean }
export const batchProgress = (batch: Pick<SettlementBatch, "total" | "reconciled">) =>
  batch.total > 0 ? Math.floor(batch.reconciled / batch.total * 100) : 0;