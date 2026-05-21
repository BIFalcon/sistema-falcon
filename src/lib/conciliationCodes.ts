/**
 * Mapeamento de Transaction Codes do Opera para categorias do TOTVS.
 * Cada categoria corresponde a uma Descrição no Razão (TOTVS).
 */

export type ConciliationCategory =
  | "Cartoes a Processar"
  | "Regularizar PIX"
  | "Regularizar Dinheiro"
  | "Notas a Faturar";

export const TRANSACTION_CODE_MAP: Record<string, ConciliationCategory> = {
  "9003": "Notas a Faturar",
  "9085": "Cartoes a Processar",
  "9087": "Cartoes a Processar",
  "9088": "Cartoes a Processar",
  "9089": "Cartoes a Processar",
  "9090": "Cartoes a Processar",
  "9091": "Cartoes a Processar",
  "9095": "Regularizar PIX",
  "9096": "Regularizar PIX",
  "9097": "Regularizar PIX",
  "9099": "Regularizar PIX",
  "9100": "Cartoes a Processar",
  "9101": "Cartoes a Processar",
  "9102": "Cartoes a Processar",
  "9103": "Cartoes a Processar",
  "9104": "Cartoes a Processar",
  "9105": "Cartoes a Processar",
  "9106": "Cartoes a Processar",
  "9107": "Cartoes a Processar",
  "9108": "Cartoes a Processar",
  "9109": "Cartoes a Processar",
  "9113": "Cartoes a Processar",
  "9120": "Cartoes a Processar",
  "9138": "Cartoes a Processar",
  "9139": "Cartoes a Processar",
  "9142": "Cartoes a Processar",
  "9148": "Cartoes a Processar",
  "9150": "Cartoes a Processar",
  "9151": "Cartoes a Processar",
  "9152": "Cartoes a Processar",
  "9153": "Cartoes a Processar",
  "9162": "Cartoes a Processar",
  "9163": "Cartoes a Processar",
  "9164": "Cartoes a Processar",
  "9165": "Cartoes a Processar",
  "9166": "Cartoes a Processar",
  "9170": "Cartoes a Processar",
  "9186": "Cartoes a Processar",
  "9188": "Cartoes a Processar",
  "9191": "Cartoes a Processar",
  "9000": "Regularizar Dinheiro",
  "9002": "Regularizar Dinheiro",
  "9160": "Regularizar Dinheiro",
  "9200": "Regularizar PIX",
};

export function getCategoriaFromCode(code: string): ConciliationCategory | null {
  return TRANSACTION_CODE_MAP[String(code).trim()] ?? null;
}

export function normalizaDescricaoRazao(desc: string): ConciliationCategory | null {
  const d = desc.toLowerCase().trim();
  // Match estritamente apenas as 4 descrições alvo do Razão.
  // Evita confundir com "Cartao Amex", "Cartao Elo", etc.
  if (/(^|\s)cart(o|õ)es?\s+a\s+processar/.test(d)) return "Cartoes a Processar";
  if (/regulariza(r|ç(ã|a)o)?\s+pix/.test(d)) return "Regularizar PIX";
  if (/regulariza(r|ç(ã|a)o)?\s+dinheiro/.test(d)) return "Regularizar Dinheiro";
  if (/notas?\s+a\s+faturar/.test(d)) return "Notas a Faturar";
  return null;
}