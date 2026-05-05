import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface FilterContextValue {
  hotelId: string | null;
  month: number;
  year: number;
  dateFrom: string;
  dateTo: string;
  setHotelId: (id: string | null) => void;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
  setDateFrom: (d: string) => void;
  setDateTo: (d: string) => void;
}

const FilterContext = createContext<FilterContextValue | undefined>(undefined);

const STORAGE_KEY = "falcon:filters";

export function FilterProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [hotelId, setHotelIdState] = useState<string | null>(null);
  const [month, setMonthState] = useState<number>(now.getMonth() + 1);
  const [year, setYearState] = useState<number>(now.getFullYear());
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const [dateFrom, setDateFromState] = useState<string>(firstOfMonth);
  const [dateTo, setDateToState] = useState<string>(lastOfMonth);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v.hotelId !== undefined) setHotelIdState(v.hotelId);
        if (typeof v.month === "number") setMonthState(v.month);
        if (typeof v.year === "number") setYearState(v.year);
        if (typeof v.dateFrom === "string") setDateFromState(v.dateFrom);
        if (typeof v.dateTo === "string") setDateToState(v.dateTo);
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hotelId, month, year, dateFrom, dateTo }),
    );
  }, [hotelId, month, year, dateFrom, dateTo]);

  return (
    <FilterContext.Provider
      value={{
        hotelId,
        month,
        year,
        dateFrom,
        dateTo,
        setHotelId: setHotelIdState,
        setMonth: setMonthState,
        setYear: setYearState,
        setDateFrom: setDateFromState,
        setDateTo: setDateToState,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters deve ser usado dentro de FilterProvider");
  return ctx;
}