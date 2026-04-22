import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface FilterContextValue {
  hotelId: string | null;
  month: number;
  year: number;
  setHotelId: (id: string | null) => void;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
}

const FilterContext = createContext<FilterContextValue | undefined>(undefined);

const STORAGE_KEY = "falcon:filters";

export function FilterProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [hotelId, setHotelIdState] = useState<string | null>(null);
  const [month, setMonthState] = useState<number>(now.getMonth() + 1);
  const [year, setYearState] = useState<number>(now.getFullYear());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v.hotelId !== undefined) setHotelIdState(v.hotelId);
        if (typeof v.month === "number") setMonthState(v.month);
        if (typeof v.year === "number") setYearState(v.year);
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hotelId, month, year }));
  }, [hotelId, month, year]);

  return (
    <FilterContext.Provider
      value={{
        hotelId,
        month,
        year,
        setHotelId: setHotelIdState,
        setMonth: setMonthState,
        setYear: setYearState,
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