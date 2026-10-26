export type SettlementProvider = "rede" | "b2b";
export interface SettlementItem {
  source: string;
  entry_id: string;
  item_date: string | null;
  original_date: string | null;
  label: string | null;
  amount: number;
  eligibility: string;
  transition_id: string | null;
}

export function isSaleInScope(date: string | null, cutoff: string | null | undefined) {
  return !cutoff || !date || date >= cutoff;
}

export function canTransition(item: SettlementItem, cutoff: string | null | undefined) {
  return !!cutoff && !item.transition_id && (item.eligibility === "anterior" || item.eligibility === "sem_origem");
}

export function excludedSettlementIds(items: SettlementItem[], cutoff: string | null | undefined) {
  return new Set(items.filter((item) => item.transition_id || (cutoff && item.eligibility === "anterior")).map((item) => `${item.source}:${item.entry_id}`));
}