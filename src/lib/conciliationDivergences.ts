export interface DivergenceSummary {
  hotel_id: string;
  hotel_name: string;
  cartao: number;
  pix: number;
  dinheiro: number;
  inadimplente: number;
}

export function divergenceCount(s: DivergenceSummary): number {
  return Number(s.cartao) + Number(s.pix) + Number(s.dinheiro) + Number(s.inadimplente);
}

export function divergenceLink(hotelId: string): string {
  return `/financeiro/contas-receber?aba=conciliacao&divergencias=1&hotel=${encodeURIComponent(hotelId)}`;
}

export function canSendDivergences(master: boolean, roles: readonly string[]): boolean {
  return master || roles.some(r => ["controladoria", "patronos", "fernando", "financeiro"].includes(r));
}