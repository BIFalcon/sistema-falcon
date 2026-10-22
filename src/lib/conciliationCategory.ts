import { normText } from "@/lib/conciliacaoParsers";

export const CONCILIATION_BASES = ["CARTAO", "PIX", "DINHEIRO", "FATURADO"] as const;
export type ConciliationBase = (typeof CONCILIATION_BASES)[number];

export function conciliationBase(value: string | null | undefined): ConciliationBase | null {
  const normalized = normText(value);
  return CONCILIATION_BASES.find((base) => base === normalized) ?? null;
}

/** The OMIE label stays intact; this key only removes equivalent spelling differences. */
export function conciliationCategoryKey(value: string | null | undefined): string | null {
  const normalized = normText(value);
  if (!normalized) return null;
  if (["AMERICAN EXPRESS", "AMERICAN EXPRESS CREDITO", "AMEX", "AMEX CREDITO"].includes(normalized)) return "AMEX CREDITO";
  if (["DINERS", "DINERS CLUB", "DINERS CREDITO", "DINERS CLUB CREDITO"].includes(normalized)) return "DINERS";
  return normalized;
}

export function operaClassification(mapping: { categoria: string | null; categoria_omie: string | null }) {
  return {
    base_conciliacao: conciliationBase(mapping.categoria),
    categoria_omie: mapping.categoria_omie?.trim() || null,
    categoria: conciliationCategoryKey(mapping.categoria_omie),
  };
}