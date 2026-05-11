import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from "react";

export type FilterModule =
  | "fechamento"
  | "financeiro"
  | "indicadores"
  | "conciliacao"
  | "consolidado"
  | "global";

interface ModuleFilters {
  hotelId: string | null;
  hotelIds: string[];
  gopId: string | null;
  month: number;
  year: number;
  dateFrom: string;
  dateTo: string;
}

function getStorageKey(module: FilterModule) {
  return `falcon:filters:${module}`;
}

function getDefaultFilters(): ModuleFilters {
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString().slice(0, 10);
  return {
    hotelId: null,
    hotelIds: [],
    gopId: null,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    dateFrom: firstOfMonth,
    dateTo: lastOfMonth,
  };
}

function loadFilters(module: FilterModule): ModuleFilters {
  try {
    const raw = localStorage.getItem(getStorageKey(module));
    if (raw) {
      const v = JSON.parse(raw);
      const def = getDefaultFilters();
      return {
        hotelId:  v.hotelId  ?? def.hotelId,
        hotelIds: Array.isArray(v.hotelIds) ? v.hotelIds : def.hotelIds,
        gopId:    v.gopId    ?? def.gopId,
        month:    typeof v.month  === "number" ? v.month  : def.month,
        year:     typeof v.year   === "number" ? v.year   : def.year,
        dateFrom: typeof v.dateFrom === "string" ? v.dateFrom : def.dateFrom,
        dateTo:   typeof v.dateTo   === "string" ? v.dateTo   : def.dateTo,
      };
    }
  } catch { /* noop */ }
  return getDefaultFilters();
}

function saveFilters(module: FilterModule, filters: ModuleFilters) {
  try {
    localStorage.setItem(getStorageKey(module), JSON.stringify(filters));
  } catch { /* noop */ }
}

export function useModuleFilters(module: FilterModule) {
  const [filters, setFilters] = useState<ModuleFilters>(() => loadFilters(module));

  useEffect(() => {
    setFilters(loadFilters(module));
  }, [module]);

  useEffect(() => {
    saveFilters(module, filters);
  }, [module, filters]);

  const setHotelId   = useCallback((v: string | null) => setFilters(f => ({ ...f, hotelId: v })), []);
  const setHotelIds  = useCallback((v: string[])      => setFilters(f => ({ ...f, hotelIds: v })), []);
  const setGopId     = useCallback((v: string | null) => setFilters(f => ({ ...f, gopId: v })), []);
  const setMonth     = useCallback((v: number)        => setFilters(f => ({ ...f, month: v })), []);
  const setYear      = useCallback((v: number)        => setFilters(f => ({ ...f, year: v })), []);
  const setDateFrom  = useCallback((v: string)        => setFilters(f => ({ ...f, dateFrom: v })), []);
  const setDateTo    = useCallback((v: string)        => setFilters(f => ({ ...f, dateTo: v })), []);

  return {
    ...filters,
    setHotelId,
    setHotelIds,
    setGopId,
    setMonth,
    setYear,
    setDateFrom,
    setDateTo,
  };
}

interface FilterContextValue extends ReturnType<typeof useModuleFilters> {}
const FilterContext = createContext<FilterContextValue | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const filters = useModuleFilters("global");
  return (
    <FilterContext.Provider value={filters}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters deve ser usado dentro de FilterProvider");
  return ctx;
}
