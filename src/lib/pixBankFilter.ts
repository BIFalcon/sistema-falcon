/** Acquirer/card settlements never count as PIX. Keep equivalent to conc_is_pix_bank. */
const ACQUIRERS = /\b(REDE|REDECARD|CIELO|STONE|GETNET|ZOOP|SAFRAPAY|PAGSEGURO|PAGBANK|SUMUP|VERO|BIN|ADYEN|AMEX)\b/;

/** Bank receipts qualify as PIX, except boleto and card-acquirer settlements. */
export function isPixBankLine(description: string | null | undefined): boolean {
  const text = String(description ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return !/\bBOLETOS?\b/.test(text) && !ACQUIRERS.test(text) && /PIX|\bRECEBIDOS\b|\bRECEBIMENTOS\b/.test(text);
}
