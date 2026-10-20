/** Carta is a single-hotel view; only use the hotels authorized by AuthContext. */
export function resolveCartaHotelId(hotelId: string | null, allowedHotelIds: readonly string[]): string | null {
  return hotelId && allowedHotelIds.includes(hotelId)
    ? hotelId
    : allowedHotelIds[0] ?? null;
}