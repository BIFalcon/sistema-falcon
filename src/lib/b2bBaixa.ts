/**
 * Filtro do extrato bancário na Baixa B2B.
 * Validado no extrato de Arcoverde: "ZOOP MAST CD…".
 * Para ajustar, mude apenas este prefixo.
 */
export const B2B_BANK_PREFIX = "ZOOP";

export function isB2BBankLine(description: string | null | undefined, prefix = B2B_BANK_PREFIX): boolean {
  return String(description ?? "").trim().toUpperCase().startsWith(prefix.toUpperCase());
}
