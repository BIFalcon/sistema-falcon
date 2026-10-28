export function canConfirmTransit(selectedCount: number, selectedTotal: number, bankAmount: number, note: string) {
  return selectedCount > 0 && bankAmount > 0 && Number.isFinite(selectedTotal) &&
    Math.round(selectedTotal * 100) === Math.round(bankAmount * 100) && note.trim().length >= 10;
}