import { useCallback, createContext, useContext, ReactNode, useSyncExternalStore } from "react";

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

// ---------------------------------------------------------------------------
// Global per-module store with pub/sub. Garantia que header e páginas
// compartilhem o MESMO estado (antes cada hook tinha useState local e só
// sincronizava via localStorage na montagem inicial — por isso era preciso
// dar F5 para os filtros do header surtirem efeito nas páginas).
// ---------------------------------------------------------------------------
const stores: Partial<Record<FilterModule, ModuleFilters>> = {};
const listeners: Partial<Record<FilterModule, Set<() => void>>> = {};

function getStore(module: FilterModule): ModuleFilters {
  let s = stores[module];
  if (!s) {
    s = loadFilters(module);
    stores[module] = s;
  }
  return s;
}

function setStore(module: FilterModule, updater: (prev: ModuleFilters) => ModuleFilters) {
  const prev = getStore(module);
  const next = updater(prev);
  if (next === prev) return;
  stores[module] = next;
  saveFilters(module, next);
  const ls = listeners[module];
  if (ls) ls.forEach((l) => l());
}

function subscribe(module: FilterModule, listener: () => void) {
  let ls = listeners[module];
  if (!ls) {
    ls = new Set();
    listeners[module] = ls;
  }
  ls.add(listener);
  return () => { ls!.delete(listener); };
}

export function useModuleFilters(module: FilterModule) {
  const filters = useSyncExternalStore(
    useCallback((cb) => subscribe(module, cb), [module]),
    useCallback(() => getStore(module), [module]),
    useCallback(() => getStore(module), [module]),
  );

  const setHotelId   = useCallback((v: string | null) => setStore(module, f => f.hotelId   === v ? f : ({ ...f, hotelId: v })),  [module]);
  const setHotelIds  = useCallback((v: string[])      => setStore(module, f => ({ ...f, hotelIds: v })), [module]);
  const setGopId     = useCallback((v: string | null) => setStore(module, f => f.gopId     === v ? f : ({ ...f, gopId: v })),    [module]);
  const setMonth     = useCallback((v: number)        => setStore(module, f => f.month     === v ? f : ({ ...f, month: v })),    [module]);
  const setYear      = useCallback((v: number)        => setStore(module, f => f.year      === v ? f : ({ ...f, year: v })),     [module]);
  const setDateFrom  = useCallback((v: string)        => setStore(module, f => f.dateFrom  === v ? f : ({ ...f, dateFrom: v })), [module]);
  const setDateTo    = useCallback((v: string)        => setStore(module, f => f.dateTo    === v ? f : ({ ...f, dateTo: v })),   [module]);

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
