/**
 * Filtro do extrato bancário na Baixa B2B.
 * A CONFIRMAR: ainda não validamos o texto exato no extrato real.
 * Hoje: descrição começando com "ZOP" (opcionalmente seguida da bandeira).
 * Para ajustar, mude apenas este prefixo.
 */
export const B2B_BANK_PREFIX = "ZOP";

export function isB2BBankLine(description: string | null | undefined, prefix = B2B_BANK_PREFIX): boolean {
  return String(description ?? "").trim().toUpperCase().startsWith(prefix.toUpperCase());
}
