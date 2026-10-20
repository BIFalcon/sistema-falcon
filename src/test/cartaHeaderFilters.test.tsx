import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";

const hotels = vi.hoisted(() => [
  { id: "manhattan", name: "Manhattan" },
  { id: "confins", name: "Confins" },
]);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  allowedHotels: hotels, roles: ["ri"], hasRole: (role: string) => role === "ri",
  isMaster: false, isGg: false, profile: null, signOut: vi.fn(),
}) }));
vi.mock("@/hooks/useNotifications", () => ({ usePendingNotificationCount: () => ({ data: 0 }) }));
vi.mock("@/hooks/useGopManagers", () => ({ useGopManagers: () => ({
  data: [{ user_id: "old-gop", hotel_ids: ["manhattan"], display_name: "GOP" }],
}) }));
vi.mock("@/contexts/FilterContext", async () => {
  const { useState } = await import("react");
  return { useModuleFilters: () => {
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [hotelIds, setHotelIds] = useState<string[]>([]);
    const [gopId, setGopId] = useState<string | null>("old-gop");
    const [month, setMonth] = useState(9);
    const [year, setYear] = useState(2026);
    return { hotelId, setHotelId, hotelIds, setHotelIds, gopId, setGopId, month, setMonth, year, setYear,
      dateFrom: "", dateTo: "", specificDates: [], setDateFrom: vi.fn(), setDateTo: vi.fn(), setSpecificDates: vi.fn() };
  } };
});
// Native selectors exercise filter changes without depending on Radix pointer APIs in jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
function openCarta(url = "/fechamento/carta") {
  render(<MemoryRouter initialEntries={[url]}><AppHeader /><Location /></MemoryRouter>);
}
afterEach(cleanup);

describe("RI Carta shared filters", () => {
  it("defaults to an authorized hotel and permits another hotel despite a stale GOP portfolio", async () => {
    openCarta();
    const hotelSelect = screen.getAllByRole("combobox")[0];
    await waitFor(() => expect(hotelSelect).toHaveValue("manhattan"));
    fireEvent.change(hotelSelect, { target: { value: "confins" } });
    await waitFor(() => expect(hotelSelect).toHaveValue("confins"));
    // The hidden portfolio must not clear the RI selection on the next render.
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "10" } });
    expect(hotelSelect).toHaveValue("confins");
  });
  it("releases a direct closing link when the hotel changes", async () => {
    openCarta("/fechamento/carta?closing=old-closing");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "confins" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/fechamento\/carta$/));
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("confins");
  });
  it("releases a direct closing link when the period changes", async () => {
    openCarta("/fechamento/carta?closing=old-closing");
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "10" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/fechamento\/carta$/));
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("10");
  });
});