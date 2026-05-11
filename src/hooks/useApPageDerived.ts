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
import { type IssueCategory } from "@/lib/apIssueCategories";

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
  /** Documento "principal" (primary_document_id) por lançamento. */
  docsByEntry: Map<string, ApDocument>;
  /** TODOS os documentos vinculados a cada lançamento. */
  allDocsByEntry: Map<string, ApDocument[]>;
  unlinkedDocs: ApDocument[];
  urgencyCounts: {
    today: number;
    tomorrow: number;
    thisWeek: number;
    nextWeek: number;
    nextMonth: number;
  };
  issueCounts: Record<IssueCategory, number>;
  issueEntries: ApEntry[];
  entryIssues: (e: ApEntry) => Set<IssueCategory>;
  totalToPayToday: number;
  totalToPayPeriod: number;
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
  hotelCnpj?: string | null;
  searchText?: string;
  dateFrom?: string;
  dateTo?: string;
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
    hotelCnpj,
    searchText,
    dateFrom,
    dateTo,
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
  const allDocsByEntry = useMemo(() => {
    const map = new Map<string, ApDocument[]>();
    documents.forEach((d) => {
      if (!d.entry_id) return;
      const arr = map.get(d.entry_id) ?? [];
      arr.push(d);
      map.set(d.entry_id, arr);
    });
    return map;
  }, [documents]);

  const primaryDocIdByEntry = useMemo(() => {
    const map = new Map<string, string>();
    allEntriesRaw.forEach((e) => {
      if (e.primary_document_id) map.set(e.id, e.primary_document_id);
    });
    return map;
  }, [allEntriesRaw]);

  const docsByEntry = useMemo(() => {
    // primary doc por entry (compat com código existente)
    const map = new Map<string, ApDocument>();
    for (const [entryId, list] of allDocsByEntry) {
      const primaryId = primaryDocIdByEntry.get(entryId);
      const primary = primaryId ? list.find((d) => d.id === primaryId) : null;
      map.set(entryId, primary ?? list[0]);
    }
    return map;
  }, [allDocsByEntry, primaryDocIdByEntry]);

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

  // ── Detecção de pendências por categoria ───────────────────────────────

  /** Valor da NF diverge do valor do lançamento (> R$ 0,01 de diferença). */
  const isValorDivergente = (e: ApEntry) => {
    const doc = docsByEntry.get(e.id);
    return (
      doc?.validation_status === "divergence" ||
      (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01)
    );
  };

  /** CNPJ do documento vinculado é diferente do CNPJ do hotel. */
  const isCnpjDivergente = (e: ApEntry) => {
    if (!hotelCnpj) return false;
    const doc = docsByEntry.get(e.id);
    if (!doc?.doc_cnpj) return false;
    const norm = (s: string) => s.replace(/\D/g, "");
    return norm(doc.doc_cnpj) !== norm(hotelCnpj);
  };

  /** Nenhum documento vinculado ao lançamento. */
  const isSemDocumento = (e: ApEntry) => !e.primary_document_id;

  /** GG ainda não aprovou (apenas para hotéis não-OMIE). */
  const isSemAprovacao = (e: ApEntry) =>
    showApproval && e.gg_approval !== "approved";

  /** Retorna todas as categorias de pendência de um lançamento. */
  const entryIssues = (e: ApEntry): Set<IssueCategory> => {
    const s = new Set<IssueCategory>();
    if (isSemAprovacao(e)) s.add("sem_aprovacao");
    if (isSemDocumento(e)) s.add("sem_documento");
    if (isValorDivergente(e)) s.add("valor_divergente");
    if (isCnpjDivergente(e)) s.add("cnpj_divergente");
    return s;
  };

  // ── Filtro principal ───────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!isWithinPeriod(e.due_date, period)) return false;
        if (status === "issues") {
          if (e.gg_approval === "approved") return false;
        }
        if (status === "payment_pendente" && e.payment_status !== "em_aprovacao") return false;
        if (status === "payment_inserido" && e.payment_status !== "inserido") return false;
        if (status === "payment_agendado" && e.payment_status !== "agendado") return false;
        if (status === "payment_pago" && e.payment_status !== "pago") return false;
        if (category !== "all" && e.category !== category) return false;
        if (hideTrivial && Number(e.amount ?? 0) < 1) return false;
        if (searchText && searchText.trim()) {
          const q = searchText.toLowerCase().trim();
          if (
            !e.supplier?.toLowerCase().includes(q) &&
            !e.cnpj?.toLowerCase().includes(q) &&
            !e.document_number?.toLowerCase().includes(q)
          ) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, period, status, category, hideTrivial, showApproval, hotelCnpj, docsByEntry, searchText],
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
  const issueCounts = useMemo(() => {
    const counts: Record<IssueCategory, number> = {
      sem_aprovacao: 0,
      sem_documento: 0,
      valor_divergente: 0,
      cnpj_divergente: 0,
    };
    entries.forEach((e) => {
      if (e.gg_approval !== "approved") counts.sem_aprovacao++;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const issueEntries = useMemo(
    () => entries.filter((e) => e.gg_approval !== "approved"),
    [entries],
  );

  // ── Totais financeiros ─────────────────────────────────────────────────
  const totalToPayToday = useMemo(
    () =>
      entries
        .filter((e) => isWithinPeriod(e.due_date, "today"))
        .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [entries],
  );

  const totalToPayPeriod = useMemo(() => {
    if (!dateFrom || !dateTo) return totalToPayToday;
    return entries
      .filter((e) => !!e.due_date && e.due_date >= dateFrom && e.due_date <= dateTo)
      .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  }, [entries, dateFrom, dateTo, totalToPayToday]);

  const distributionTotal = useMemo(
    () => distributionEntries.reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [distributionEntries],
  );

  const balanceAmount = balance ? Number(balance.amount) : null;
  const balanceDiff = balanceAmount !== null ? balanceAmount - totalToPayPeriod : null;

  return {
    entries,
    distributionEntries,
    archivedEntries,
    filtered,
    displayRows,
    categories,
    docsByEntry,
    allDocsByEntry,
    unlinkedDocs,
    urgencyCounts,
    issueCounts,
    issueEntries,
    entryIssues,
    totalToPayToday,
    totalToPayPeriod,
    distributionTotal,
    balanceDiff,
  };
}
