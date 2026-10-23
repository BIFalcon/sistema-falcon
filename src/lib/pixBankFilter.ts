/** Bank receipts qualify as PIX, except boleto settlements. */
export function isPixBankLine(description: string | null | undefined): boolean {
  const text = String(description ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return !/\bBOLETOS?\b/.test(text) && /PIX|\bRECEBIDOS\b|\bRECEBIMENTOS\b/.test(text);
}