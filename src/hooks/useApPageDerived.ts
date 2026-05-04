/**
 * Hook central da página Contas a Pagar.
 * Concentra toda a lógica de derivação de dados (memos, counts, display rows)
 * que antes vivia dentro do componente de página.
 *
 * O componente de página fica responsável apenas por renderização e handlers.
 */
import { useMemo } from "react";
import type { ApDocument, ApEntry, FinancialSystem } from "@/hooks/useAccountsPayable";
import { isWithinPeriod, type Period, type StatusFilter } from "@/lib/apPeriodFilter";

// ── Tipos ───────────────────────────────────────────────────────────────────

export type DisplayRow =
  | { kind: "single"; entry: ApEntry }
  | {
      kind: "group";
      supplier: string;
      due: string | null;
      entries: ApEntry[];
      amount: number;
    };

export interface ApPageDerived {
  entries: ApEntry[];
  distributionEntries: ApEntry[];
  archivedEntries: ApEntry[];
  filtered: ApEntry[];
  displayRows: DisplayRow[];
  categories: string[];
  docsByEntry: Map<string, ApDocument>;
  unlinkedDocs: ApDocument[];
  urgencyCounts: {
    today: number;
    tomorrow: number;
    thisWeek: number;
    nextWeek: number;
    nextMonth: number;
  };
  issueCounts: {
    notApproved: number;
    noDoc: number;
    overdue: number;
    divergent: number;
  };
  issueEntries: ApEntry[];
  totalToPayToday: number;
  distributionTotal: number;
  balanceDiff: number | null;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useApPageDerived(opts: {
  allEntriesRaw: ApEntry[];
  documents: ApDocument[];
  balance: { amount: number } | null | undefined;
  sourceSystem: FinancialSystem | null;
  period: Period;
  status: StatusFilter;
  category: string;
  hideTrivial: boolean;
  groupNd: boolean;
  showApproval: boolean;
}): ApPageDerived {
  const {
    allEntriesRaw,
    documents,
    balance,
    period,
    status,
    category,
    hideTrivial,
    groupNd,
    showApproval,
    sourceSystem,
  } = opts;

  // ── Separação base ─────────────────────────────────────────────────────
  const activeEntries = useMemo(
    () => allEntriesRaw.filter((e) => !e.archived_at),
    [allEntriesRaw],
  );
  const archivedEntries = useMemo(
    () => allEntriesRaw.filter((e) => !!e.archived_at),
    [allEntriesRaw],
  );
  const distributionEntries = useMemo(
    () => activeEntries.filter((e) => e.is_distribution),
    [activeEntries],
  );
  const entries = useMemo(
    () => activeEntries.filter((e) => !e.is_distribution),
    [activeEntries],
  );

  // ── Documentos ─────────────────────────────────────────────────────────
  const docsByEntry = useMemo(() => {
    const map = new Map<string, ApDocument>();
    documents.forEach((d) => { if (d.entry_id) map.set(d.entry_id, d); });
    return map;
  }, [documents]);

  const unlinkedDocs = useMemo(
    () => documents.filter((d) => !d.entry_id),
    [documents],
  );

  // ── Categorias OMIE ────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => e.category && set.add(e.category));
    return Array.from(set).sort();
  }, [entries]);

  // ── Filtro principal ───────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!isWithinPeriod(e.due_date, period)) return false;
        if (status === "pending" && e.gg_approval !== "pending") return false;
        if (status === "approved" && e.gg_approval !== "approved") return false;
        if (status === "no_doc" && !!e.primary_document_id) return false;
        if (status === "issues") {
          const overdue = e.omie_situation?.toLowerCase().includes("atras");
          const noApproval = showApproval && e.gg_approval !== "approved";
          const noDoc = !e.primary_document_id;
          if (!overdue && !noApproval && !noDoc) return false;
        }
        if (category !== "all" && e.category !== category) return false;
        if (hideTrivial && Number(e.amount ?? 0) < 1) return false;
        return true;
      }),
    [entries, period, status, category, hideTrivial, showApproval],
  );

  // ── Agrupamento N/D ────────────────────────────────────────────────────
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!groupNd) return filtered.map((e) => ({ kind: "single", entry: e }));

    const groups = new Map<string, ApEntry[]>();
    const singles: ApEntry[] = [];

    for (const e of filtered) {
      const isNd =
        !e.document_number ||
        e.document_number.trim() === "" ||
        e.document_number.toUpperCase() === "N/D";
      if (isNd) {
        const key = `${e.supplier}|${e.due_date ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
      } else {
        singles.push(e);
      }
    }

    const rows: DisplayRow[] = singles.map((e) => ({ kind: "single", entry: e }));
    for (const [key, arr] of groups) {
      if (arr.length === 1) {
        rows.push({ kind: "single", entry: arr[0] });
      } else {
        const [supplier, due] = key.split("|");
        rows.push({
          kind: "group",
          supplier,
          due: due || null,
          entries: arr,
          amount: arr.reduce((s, x) => s + Number(x.amount ?? 0), 0),
        });
      }
    }

    rows.sort((a, b) => {
      const da = a.kind === "single" ? a.entry.due_date : a.due;
      const db = b.kind === "single" ? b.entry.due_date : b.due;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
    return rows;
  }, [filtered, groupNd]);

  // ── Urgência ───────────────────────────────────────────────────────────
  const urgencyCounts = useMemo(() => {
    const c = { today: 0, tomorrow: 0, thisWeek: 0, nextWeek: 0, nextMonth: 0 };
    entries.forEach((e) => {
      if (isWithinPeriod(e.due_date, "today")) c.today++;
      else if (isWithinPeriod(e.due_date, "tomorrow")) c.tomorrow++;
      else if (isWithinPeriod(e.due_date, "this_week")) c.thisWeek++;
      else if (isWithinPeriod(e.due_date, "next_week")) c.nextWeek++;
      else if (isWithinPeriod(e.due_date, "next_month")) c.nextMonth++;
    });
    return c;
  }, [entries]);

  // ── Problemas ──────────────────────────────────────────────────────────
  const isDivergent = (e: ApEntry) => {
    const doc = docsByEntry.get(e.id);
    return (
      doc?.validation_status === "divergence" ||
      (doc?.nf_amount != null &&
        Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01)
    );
  };

  const issueCounts = useMemo(() => {
    let notApproved = 0, noDoc = 0, overdue = 0, divergent = 0;
    entries.forEach((e) => {
      if (showApproval && e.gg_approval !== "approved") notApproved++;
      if (!e.primary_document_id) noDoc++;
      if (e.omie_situation?.toLowerCase().includes("atras")) overdue++;
      if (isDivergent(e)) divergent++;
    });
    return { notApproved, noDoc, overdue, divergent };
  }, [entries, docsByEntry, showApproval]);

  const issueEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.omie_situation?.toLowerCase().includes("atras") ||
          (showApproval && e.gg_approval !== "approved") ||
          !e.primary_document_id ||
          isDivergent(e),
      ),
    [entries, docsByEntry, showApproval],
  );

  // ── Totais financeiros ─────────────────────────────────────────────────
  const totalToPayToday = useMemo(
    () =>
      entries
        .filter((e) => isWithinPeriod(e.due_date, "today"))
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [entries],
  );

  const distributionTotal = useMemo(
    () => distributionEntries.reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [distributionEntries],
  );

  const balanceAmount = balance ? Number(balance.amount) : null;
  const balanceDiff = balanceAmount !== null ? balanceAmount - totalToPayToday : null;

  return {
    entries,
    distributionEntries,
    archivedEntries,
    filtered,
    displayRows,
    categories,
    docsByEntry,
    unlinkedDocs,
    urgencyCounts,
    issueCounts,
    issueEntries,
    totalToPayToday,
    distributionTotal,
    balanceDiff,
  };
}
