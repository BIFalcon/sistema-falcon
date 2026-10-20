import { describe, expect, it } from "vitest";
import { resolveCartaHotelId } from "@/lib/cartaHotelSelection";

describe("Carta hotel selection for RI", () => {
  it("selects an available hotel when the filter is empty", () => {
    expect(resolveCartaHotelId(null, ["manhattan", "confins"])).toBe("manhattan");
  });
  it("preserves the selected authorized hotel, including hotels beyond the first", () => {
    expect(resolveCartaHotelId("confins", ["manhattan", "confins"])).toBe("confins");
  });
  it("replaces a stale unauthorized selection", () => {
    expect(resolveCartaHotelId("old-hotel", ["manhattan", "confins"])).toBe("manhattan");
  });
  it("never invents access when no hotels are available", () => {
    expect(resolveCartaHotelId("manhattan", [])).toBeNull();
  });
});