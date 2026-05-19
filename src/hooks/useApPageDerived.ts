/**
 * Hook central da página Contas a Pagar.
 * Concentra toda a lógica de derivação de dados (memos, counts, display rows)
 * que antes vivia dentro do componente de página.
 *
 * O componente de página fica responsável apenas por renderização e handlers.
 */
import { useMemo } from "react";
import type { ApDocument, ApEntry, FinancialSystem } from "@/hooks/useAccountsPayable";
import { isWithinPeriod, type Period } from "@/lib/apPeriodFilter";
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
  overdueCount: number;
  showOriginalAmount: boolean;
  showPaidAmount: boolean;
  showPaidInterest: boolean;
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
  selectedStatuses: string[];
  selectedCategories: string[];
  hideTrivial: boolean;
  groupNd: boolean;
  showApproval: boolean;
  hotelCnpj?: string | null;
  searchText?: string;
  dateFrom?: string;
  dateTo?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  specificDates?: string[];
}): ApPageDerived {
  const {
    allEntriesRaw,
    documents,
    balance,
    period,
    selectedStatuses,
    selectedCategories,
    hideTrivial,
    groupNd,
    showApproval,
    sourceSystem,
    hotelCnpj,
    searchText,
    dateFrom,
    dateTo,
    scheduledFrom,
    scheduledTo,
    specificDates,
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
        if (selectedStatuses.length > 0) {
          const ok = selectedStatuses.some((s) => {
            if (s === "issues") return e.gg_approval !== "approved";
            return e.payment_status === s;
          });
          if (!ok) return false;
        }
        if (selectedCategories.length > 0) {
          if (!e.category || !selectedCategories.includes(e.category)) return false;
        }
        if (hideTrivial && Number(e.amount ?? 0) < 1) return false;
        // Filtro de vencimento (também afeta a tabela)
        if (specificDates && specificDates.length > 0) {
          if (!e.due_date || !specificDates.includes(e.due_date)) return false;
        } else {
          if (dateFrom && (!e.due_date || e.due_date < dateFrom)) return false;
          if (dateTo && (!e.due_date || e.due_date > dateTo)) return false;
        }
        if (scheduledFrom || scheduledTo) {
          if (!e.scheduled_date) return false;
          if (scheduledFrom && e.scheduled_date < scheduledFrom) return false;
          if (scheduledTo && e.scheduled_date > scheduledTo) return false;
        }
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
    [entries, period, selectedStatuses, selectedCategories, hideTrivial, showApproval, hotelCnpj, docsByEntry, searchText, dateFrom, dateTo, scheduledFrom, scheduledTo, specificDates],
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
  // filteredSemPeriod: mesmos filtros que "filtered" mas SEM o filtro de período
  // e SEM o filtro de data (dateFrom/dateTo/specificDates). Usado para os
  // contadores de urgência — cada card conta o seu próprio período.
  const filteredSemPeriod = useMemo(
    () =>
      entries.filter((e) => {
        if (selectedStatuses.length > 0) {
          const ok = selectedStatuses.some((s) => {
            if (s === "issues") return e.gg_approval !== "approved";
            return e.payment_status === s;
          });
          if (!ok) return false;
        }
        if (selectedCategories.length > 0) {
          if (!e.category || !selectedCategories.includes(e.category)) return false;
        }
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
    [entries, selectedStatuses, selectedCategories, hideTrivial, searchText],
  );

  const urgencyCounts = useMemo(() => {
    const c = { today: 0, tomorrow: 0, thisWeek: 0, nextWeek: 0, nextMonth: 0 };
    filteredSemPeriod.forEach((e) => {
      if (isWithinPeriod(e.due_date, "today"))          c.today++;
      else if (isWithinPeriod(e.due_date, "tomorrow"))  c.tomorrow++;
      else if (isWithinPeriod(e.due_date, "this_week")) c.thisWeek++;
      else if (isWithinPeriod(e.due_date, "next_week")) c.nextWeek++;
      else if (isWithinPeriod(e.due_date, "next_month"))c.nextMonth++;
    });
    return c;
  }, [filteredSemPeriod]);

  const overdueCount = useMemo(
    () => filteredSemPeriod.filter((e) => isWithinPeriod(e.due_date, "overdue")).length,
    [filteredSemPeriod],
  );

  // Visibilidade das colunas Valor Original/Novo/Juros — só aparecem se houver
  // pelo menos um entry com valor relevante.
  const showOriginalAmount = useMemo(
    () => entries.some((e) => e.original_amount != null
      && Number(e.original_amount) !== Number(e.amount)),
    [entries],
  );
  const showPaidAmount = useMemo(
    () => entries.some((e) => e.paid_amount != null),
    [entries],
  );
  const showPaidInterest = useMemo(
    () => entries.some((e) => e.paid_interest != null && Number(e.paid_interest) !== 0),
    [entries],
  );

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
    const isRelevant = (e: ApEntry) => {
      const bank = (e.bank_account ?? "").toLowerCase();
      const cat  = (e.category  ?? "").toLowerCase();
      const isBank = bank.includes("itau") || bank.includes("santander");
      const isSalary =
        cat.includes("salario") || cat.includes("salário") ||
        cat.includes("folha")   || cat.includes("rescisao") ||
        cat.includes("rescisão")|| cat.includes("ferias")   ||
        cat.includes("férias")  || cat.includes("13");
      return isBank || isSalary;
    };

    const relevant = entries.filter(isRelevant);
    const distTotal = distributionEntries
      .reduce((s, e) => s + Number(e.amount ?? 0), 0);

    if (specificDates && specificDates.length > 0) {
      const set = new Set(specificDates);
      return relevant
        .filter((e) => !!e.due_date && set.has(e.due_date))
        .reduce((s, e) => s + Number(e.amount ?? 0), 0) + distTotal;
    }
    if (!dateFrom || !dateTo) {
      return relevant.reduce((s, e) => s + Number(e.amount ?? 0), 0) + distTotal;
    }
    return relevant
      .filter((e) => !!e.due_date && e.due_date >= dateFrom && e.due_date <= dateTo)
      .reduce((s, e) => s + Number(e.amount ?? 0), 0) + distTotal;
  }, [entries, distributionEntries, dateFrom, dateTo, specificDates]);

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
    overdueCount,
    showOriginalAmount,
    showPaidAmount,
    showPaidInterest,
    issueCounts,
    issueEntries,
    entryIssues,
    totalToPayToday,
    totalToPayPeriod,
    distributionTotal,
    balanceDiff,
  };
}
