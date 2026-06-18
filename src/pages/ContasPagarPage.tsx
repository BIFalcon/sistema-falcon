/**
 * ContasPagarPage — versão refatorada.
 *
 * Esta página é agora um orchestrador fino:
 *  - busca dados via hooks
 *  - delega derivações para useApPageDerived
 *  - renderiza sub-componentes isolados
 *
 * O que foi extraído:
 *  - fmtBRL / fmtDate / fmtDateTime  → src/lib/formatters.ts
 *  - isWithinPeriod / Period / StatusFilter → src/lib/apPeriodFilter.ts
 *  - Stat / UrgencyCell              → components/accounts-payable/ApStatCards.tsx
 *  - EntryRow                        → components/accounts-payable/ApEntryRow.tsx
 *  - LinkDocDialog                   → components/accounts-payable/LinkDocDialog.tsx
 *  - NotifyGgDialog                  → components/accounts-payable/NotifyGgDialog.tsx
 *  - todos os useMemo de derivação    → hooks/useApPageDerived.ts
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Banknote, Building2, CalendarClock, CalendarX, CheckCircle2, ChevronDown, ChevronUp, Clock, CreditCard, FileDown, FileSpreadsheet, Filter, Loader2, Mail, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, Wallet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAllHotels, useHotelFinancial, type HotelRow } from "@/hooks/useHotelAssets";
import {
  uploadApReport,
  useApEntries,
  useAllApEntries,
  useApPaidEntries,
  useApOmieRemovedEntries,
  useRestoreApEntry,
  useLatestApUpload,
  useSetEntryPaymentStatus,
  useUnscheduleEntries,
  useSetEntryPending,
  useTodayBankBalance,
  useUpsertBankBalance,
  useApNotificationLog,
  useCardReceivable,
  useUpsertCardReceivable,
  useUpdateCardReceivable,
  useDeleteCardReceivable,
  useUpdateEntryCategory,
  useGroupEntries,
  useCreateManualEntry,
  useCreateTransferEntry,
  type ApEntry,
  type ApPaymentStatus,
  type FinancialSystem,
} from "@/hooks/useAccountsPayable";
import { useApPageDerived } from "@/hooks/useApPageDerived";
import type { Period } from "@/lib/apPeriodFilter";
import { isWithinPeriod } from "@/lib/apPeriodFilter";
import { fmtBRL, fmtDate, fmtDateTime, handlePasteBRL } from "@/lib/formatters";

import { ApEntryRow, PaymentStatusBadge } from "@/components/accounts-payable/ApEntryRow";
import { Stat, UrgencyCell } from "@/components/accounts-payable/ApStatCards";
import { NotifyGgDialog } from "@/components/accounts-payable/NotifyGgDialog";
import { EmptyHotelState } from "@/components/ui/EmptyHotelState";
import { TableSkeleton } from "@/components/ui/TableSkeleton";

import { useMemo } from "react";

export default function ContasPagarPage() {
  const {
    user,
    hasRole,
    isMaster,
    isFinanceiroEquipe,
    isFinanceiroCoordenadora,
    isFernando,
  } = useAuth();
  const qc = useQueryClient();
  const canManage = !isFernando && (isMaster || hasRole("financeiro"));
  // Marcações em lote — equipe pode marcar Agendado; só coordenadora/master pode Pago.
  const canMarkInsertedAgendado =
    isMaster ||
    isFinanceiroEquipe ||
    isFinanceiroCoordenadora ||
    hasRole("controladoria");
  const canMarkPaid = !isFernando && (isMaster || isFinanceiroCoordenadora);
  const canMarkAutorizado = !isFernando && (isMaster || isFinanceiroCoordenadora);
  const isGg = hasRole("gg");
  const canApproveBase = canManage || isGg;

  const { data: hotels = [] } = useAllHotels();
  const {
    hotelId,
    dateFrom,
    dateTo,
    specificDates,
    setDateFrom,
    setDateTo,
    setSpecificDates,
  } = useModuleFilters("financeiro");
  const hotel = useMemo(
    () => (hotels.find((h) => h.id === hotelId) ?? null) as HotelRow | null,
    [hotels, hotelId],
  );
  const sourceSystem = (hotel?.financial_system ?? null) as FinancialSystem | null;
  const isOmie = sourceSystem === "omie";
  // Hotéis OMIE não têm aprovação GG no Falcon — correção é feita direto no OMIE.
  const showApproval = !isOmie;
  const canApprove = canApproveBase && showApproval;

  // ── Dados remotos ──────────────────────────────────────────────────────
  const { data: lastUpload } = useLatestApUpload(hotelId);
  const { data: hotelEntries = [], isLoading: hotelEntriesLoading } = useApEntries(hotelId);
  const showingAllHotels = !hotelId;
  const { data: allHotelEntries = [], isLoading: allEntriesLoading } =
    useAllApEntries(showingAllHotels);
  const allEntriesRaw = showingAllHotels ? allHotelEntries : hotelEntries;
  const entriesLoading = showingAllHotels ? allEntriesLoading : hotelEntriesLoading;
  const hotelNameById = useMemo(() => {
    const m = new Map<string, string>();
    hotels.forEach((h) => m.set(h.id, h.name));
    return m;
  }, [hotels]);
  const { data: balanceItau } = useTodayBankBalance(hotelId, "itau");
  const { data: balanceSantander } = useTodayBankBalance(hotelId, "santander");
  const { data: cardReceivables = [] } = useCardReceivable(hotelId);
  const { data: notifLog = [] } = useApNotificationLog(hotelId);
  const { data: hotelFinancial = null } = useHotelFinancial(hotelId);

  // ── Mutations ──────────────────────────────────────────────────────────
  const upsertBalance = useUpsertBankBalance();
  const setPaymentStatus = useSetEntryPaymentStatus();
  const unscheduleEntries = useUnscheduleEntries();
  const setPending = useSetEntryPending();
  const upsertCard = useUpsertCardReceivable();
  const updateCard = useUpdateCardReceivable();
  const deleteCard = useDeleteCardReceivable();
  const updateCategory = useUpdateEntryCategory();

  // ── Estado local ───────────────────────────────────────────────────────
  const [balanceItauInput, setBalanceItauInput] = useState("");
  const [balanceSantanderInput, setBalanceSantanderInput] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [cardFrom, setCardFrom] = useState("");
  const [cardTo, setCardTo] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [hideTrivial, setHideTrivial] = useState(true);
  // Agrupamento automático de lançamentos N/D foi removido a pedido do time —
  // mantemos o flag em `false` para preservar a assinatura do hook derivado.
  const groupNd = false;
  const [searchText, setSearchText] = useState<string>("");
  const [scheduledFrom, setScheduledFrom] = useState<string>("");
  const [scheduledTo, setScheduledTo] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reimportConfirmOpen, setReimportConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledPaidAmount, setScheduledPaidAmount] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupCategoryName, setGroupCategoryName] = useState("");
  const groupEntries = useGroupEntries();

  // Lançamento manual / Transferência (item 4)
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMode, setManualMode] = useState<"manual" | "transfer">("manual");
  const [manualForm, setManualForm] = useState({
    supplier: "",
    cnpj: "",
    documentNumber: "",
    dueDate: "",
    amount: "",
    category: "",
    paymentMethod: "",
    bankAccount: "",
    paymentStatus: "em_aprovacao" as ApPaymentStatus,
    observation: "",
  });
  const [transferForm, setTransferForm] = useState({
    fromBank: "itau",
    toBank: "santander",
    amount: "",
    dueDate: "",
    observation: "",
  });
  const createManual = useCreateManualEntry();
  const createTransfer = useCreateTransferEntry();

  // Saldo bancário — collapse/expand (item 2)
  const [balanceExpanded, setBalanceExpanded] = useState(false);

  // Toggle "Ver pagos" (Bloco 7)
  const [showPaid, setShowPaid] = useState(false);
  const { data: paidEntries = [] } = useApPaidEntries(hotelId, showPaid);

  // Toggle "Removidos do OMIE" — lançamentos arquivados que não foram pagos
  const [showOmieRemoved, setShowOmieRemoved] = useState(false);
  const { data: omieRemovedEntries = [] } = useApOmieRemovedEntries(hotelId, showOmieRemoved);
  const restoreApEntry = useRestoreApEntry();

  // Edição inline de cartão a receber (Bloco 11)
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardAmount, setEditCardAmount] = useState("");
  const [editCardFrom, setEditCardFrom] = useState("");
  const [editCardTo, setEditCardTo] = useState("");

  // Ordenação por coluna (Valor / Vencimento)
  const [sortField, setSortField] = useState<"amount" | "due_date" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Derivações ─────────────────────────────────────────────────────────
  const derived = useApPageDerived({
    allEntriesRaw,
    documents: [],
    balance: balanceItau,
    sourceSystem,
    period,
    selectedStatuses,
    selectedCategories,
    hideTrivial,
    groupNd,
    showApproval,
    hotelCnpj: hotelFinancial?.cnpj ?? null,
    searchText,
    dateFrom,
    dateTo,
    scheduledFrom,
    scheduledTo,
    specificDates,
  });

  const {
    entries,
    salaryEntries,
    distributionEntries,
    filteredDistribution,
    filtered,
    displayRows: displayRowsRaw,
    categories,
    urgencyCounts,
    overdueCount,
    showOriginalAmount,
    showPaidAmount,
    showPaidInterest,
    issueCounts,
    issueEntries,
    totalToPayPeriod,
    distributionTotal,
    balanceDiff,
  } = derived;

  // Aplica ordenação por coluna em cima do displayRows derivado.
  // Linhas do tipo "group" são mantidas no topo (a ordenação só altera entre singles).
  const displayRows = useMemo(() => {
    if (!sortField) return displayRowsRaw;
    const groups = displayRowsRaw.filter((r) => r.kind === "group");
    const singles = displayRowsRaw.filter((r) => r.kind === "single");
    const sortedSingles = [...singles].sort((a, b) => {
      const ea = (a as { entry: ApEntry }).entry;
      const eb = (b as { entry: ApEntry }).entry;
      if (sortField === "amount") {
        const va = Number(ea.amount ?? 0);
        const vb = Number(eb.amount ?? 0);
        return sortDir === "asc" ? va - vb : vb - va;
      }
      // due_date — string YYYY-MM-DD
      const va = ea.due_date ?? "";
      const vb = eb.due_date ?? "";
      if (va === vb) return 0;
      return sortDir === "asc" ? (va < vb ? -1 : 1) : (va < vb ? 1 : -1);
    });
    return [...groups, ...sortedSingles];
  }, [displayRowsRaw, sortField, sortDir]);

  function toggleSort(field: "amount" | "due_date") {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  // Linhas efetivas exibidas — alterna entre ativos (displayRows) e pagos
  const effectiveDisplayRows = useMemo<typeof displayRows>(() => {
    if (!showPaid) return displayRows;
    return paidEntries.map((e) => ({ kind: "single" as const, entry: e }));
  }, [showPaid, displayRows, paidEntries]);
  const sortIndicator = (field: "amount" | "due_date") =>
    sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕";

  // Filtro período x filtro de data: ao escolher uma data manual, reseta o card
  // de urgência ativo para "all" (não conflitar). A limpeza inversa acontece
  // nos onClick dos cards de urgência abaixo.
  useEffect(() => {
    if ((dateFrom || dateTo || (specificDates && specificDates.length > 0)) && period !== "all") {
      setPeriod("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, specificDates]);

  function selectUrgencyPeriod(next: Period) {
    const toggleOff = period === next;
    setPeriod(toggleOff ? "all" : next);
    if (specificDates && specificDates.length > 0) setSpecificDates([]);
    if (toggleOff) {
      setDateFrom("");
      setDateTo("");
      return;
    }
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = iso(today);
    if (next === "today") { setDateFrom(todayIso); setDateTo(todayIso); }
    else if (next === "tomorrow") {
      const t = new Date(today); t.setDate(t.getDate() + 1);
      const tIso = iso(t);
      setDateFrom(tIso); setDateTo(tIso);
    } else if (next === "this_week") {
      const end = new Date(today); end.setDate(end.getDate() + (6 - today.getDay()));
      setDateFrom(todayIso); setDateTo(iso(end));
    } else if (next === "next_week") {
      const start = new Date(today); start.setDate(start.getDate() + (7 - today.getDay()));
      const end = new Date(start); end.setDate(end.getDate() + 6);
      setDateFrom(iso(start)); setDateTo(iso(end));
    } else if (next === "next_month") {
      const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      setDateFrom(iso(start)); setDateTo(iso(end));
    } else if (next === "overdue") {
      setDateFrom("2020-01-01");
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      setDateTo(iso(yest));
    } else {
      setDateFrom(""); setDateTo("");
    }
  }

  const balanceItauAmount = balanceItau ? Number(balanceItau.amount) : null;
  const balanceSantanderAmount = balanceSantander ? Number(balanceSantander.amount) : null;
  const balanceTotal =
    (balanceItauAmount ?? 0) + (balanceSantanderAmount ?? 0);
  const hasAnyBalance = balanceItauAmount !== null || balanceSantanderAmount !== null;
  const balanceDiffComputed = hasAnyBalance ? balanceTotal - totalToPayPeriod : null;
  const acceptedExt = sourceSystem === "totvs" ? ".xls" : ".xlsx,.zip";

  // Soma da seleção em lote
  const selectedTotal = useMemo(() => {
    let sum = 0;
    const effective = (e: { amount: number | null; paid_amount?: number | null; paid_interest?: number | null }) => {
      const hasInterest = e.paid_interest != null && Number(e.paid_interest) !== 0;
      return hasInterest && e.paid_amount != null
        ? Number(e.paid_amount)
        : Number(e.amount ?? 0);
    };
    for (const e of entries) if (selectedIds.has(e.id)) sum += effective(e);
    for (const e of distributionEntries) if (selectedIds.has(e.id)) sum += effective(e);
    return sum;
  }, [selectedIds, entries, distributionEntries]);

  // Indica se há lançamento vencido (due_date < hoje) entre os selecionados.
  const selectionHasOverdue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const all = [...entries, ...distributionEntries];
    return all.some(
      (e) => selectedIds.has(e.id) && e.due_date && e.due_date < today,
    );
  }, [selectedIds, entries, distributionEntries]);

  // ── Handlers ───────────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !hotelId || !sourceSystem) return;
    if (fileRef.current) fileRef.current.value = "";
    if (entries.length > 0) {
      setPendingFile(f);
      setReimportConfirmOpen(true);
      return;
    }
    await executeUpload(f);
  }

  async function executeUpload(f: File) {
    if (!hotelId || !sourceSystem) return;
    setUploading(true);
    try {
      const r = await uploadApReport({ hotelId, sourceSystem, file: f });
      const duplicatesMsg = r.skipped?.duplicate_entry
        ? ` (${r.skipped.duplicate_entry} duplicado(s) ignorado(s))`
        : "";
      toast.success(
        `Importado: ${r.entries} lançamentos${duplicatesMsg}${r.documents_extracted ? `, ${r.documents_extracted} documentos` : ""}`,
      );
      window.dispatchEvent(new CustomEvent("ap:refresh"));
      qc.invalidateQueries({ queryKey: ["ap-entries", hotelId] });
      qc.invalidateQueries({ queryKey: ["ap-entries-all"] });
      qc.invalidateQueries({ queryKey: ["ap-latest-upload", hotelId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setUploading(false);
      setPendingFile(null);
    }
  }

  async function handleBulkPaymentStatus(newStatus: ApPaymentStatus) {
    if (!hotelId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (newStatus === "pago" && !canMarkPaid) {
      toast.error("Apenas a coordenadoria do financeiro pode marcar como Pago");
      return;
    }
    if (newStatus === "autorizado" && !canMarkAutorizado) {
      toast.error("Apenas a coordenadoria do financeiro pode autorizar pagamentos");
      return;
    }
    if (newStatus === "agendado" && !canMarkInsertedAgendado) {
      toast.error("Sem permissão para alterar status");
      return;
    }
    // Agendado → abre modal (data + valor novo opcional)
    if (newStatus === "agendado") {
      setScheduledDate("");
      // Pré-preenche com o total selecionado; equipe pode alterar para
      // refletir juros (valor maior) ou desconto (valor menor).
      setScheduledPaidAmount(selectedTotal.toFixed(2));
      setSchedulingOpen(true);
      return;
    }
    await executeStatusChange(newStatus);
  }

  async function executeStatusChange(
    newStatus: ApPaymentStatus,
    extra?: { scheduledDate?: string; paidInterest?: number; paidAmount?: number },
  ) {
    if (!hotelId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Captura status anterior para permitir desfazer
    const previousByEntry = new Map<string, ApPaymentStatus>();
    const allEntries = [...entries, ...distributionEntries];
    for (const e of allEntries) {
      if (selectedIds.has(e.id)) previousByEntry.set(e.id, e.payment_status);
    }
    const prevStatus = previousByEntry.get(ids[0]) ?? "em_aprovacao";
    try {
      await setPaymentStatus.mutateAsync({
        hotelId,
        entryIds: ids,
        status: newStatus,
        scheduledDate: extra?.scheduledDate ?? null,
        paidInterest: extra?.paidInterest ?? null,
        paidAmount: extra?.paidAmount ?? null,
      });
      setSelectedIds(new Set());
      toast.success(`${ids.length} lançamento(s) marcados como ${labelForStatus(newStatus)}`, {
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            try {
              await setPaymentStatus.mutateAsync({
                hotelId,
                entryIds: ids,
                status: prevStatus,
              });
              toast.success("Ação desfeita.");
            } catch {
              toast.error("Não foi possível desfazer.");
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const visibleIds = effectiveDisplayRows.flatMap((r) => (r.kind === "single" ? [r.entry.id] : []));
      if (checked) visibleIds.forEach((id) => next.add(id));
      else visibleIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function labelForStatus(s: ApPaymentStatus) {
    return s === "pago"
      ? "Pago"
      : s === "pago_parcialmente"
      ? "Pago Parcialmente"
      : s === "agendado"
      ? "Agendado"
      : s === "autorizado"
      ? "Autorizado"
      : s === "em_aprovacao"
      ? "Em Aprovação"
      : "Não aprovado pelo GG";
  }

  // ── Desagendar em lote ────────────────────────────────────────────────
  async function handleBulkUnschedule() {
    if (!hotelId) return;
    const ids = Array.from(selectedIds);
    const allEntries = [...entries, ...salaryEntries, ...distributionEntries];
    const scheduledIds = ids.filter((id) =>
      allEntries.find((e) => e.id === id)?.payment_status === "agendado",
    );
    if (scheduledIds.length === 0) {
      toast.info("Nenhum lançamento agendado selecionado");
      return;
    }
    try {
      await unscheduleEntries.mutateAsync({ hotelId, entryIds: scheduledIds });
      setSelectedIds(new Set());
      toast.success(`${scheduledIds.length} lançamento(s) desagendados`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desagendar");
    }
  }

  // ── Marcar/desmarcar Pendente em lote ─────────────────────────────────
  async function handleBulkPending() {
    if (!hotelId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const allEntries = [...entries, ...salaryEntries, ...distributionEntries];
    const selectedEntries = ids
      .map((id) => allEntries.find((e) => e.id === id))
      .filter((e): e is ApEntry => !!e);
    // Se todos já estão pendentes, desmarca; caso contrário, marca todos.
    const allPending = selectedEntries.length > 0 && selectedEntries.every((e) => !!e.is_pending);
    const next = !allPending;
    try {
      await setPending.mutateAsync({ hotelId, entryIds: ids, pending: next });
      setSelectedIds(new Set());
      toast.success(
        next
          ? `${ids.length} lançamento(s) marcados como pendente`
          : `${ids.length} lançamento(s) tiveram a marcação 'pendente' removida`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  }

  // Block 8 — Marca categoria "Salários RH" em lote
  async function handleBulkCategory(category: string) {
    if (!hotelId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Guarda categorias anteriores para permitir desfazer
    const allEntries = [...entries, ...salaryEntries, ...distributionEntries];
    const prevCategories = ids.map((id) => ({
      id,
      prev: allEntries.find((e) => e.id === id)?.category ?? null,
    }));
    try {
      for (const id of ids) {
        await updateCategory.mutateAsync({ entryId: id, hotelId, category });
      }
      setSelectedIds(new Set());
      toast.success(`${ids.length} lançamento(s) marcado(s) como ${category}`, {
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            try {
              for (const { id, prev } of prevCategories) {
                await updateCategory.mutateAsync({ entryId: id, hotelId, category: prev });
              }
              qc.invalidateQueries({ queryKey: ["ap-entries", hotelId] });
              toast.success("Marcação desfeita.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao desfazer");
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar categoria");
    }
  }

  // Block 11 — Editar/excluir entradas de saldo de cartão
  function startEditCard(c: { id: string; amount: number | string; date_from: string; date_to: string }) {
    setEditingCardId(c.id);
    setEditCardAmount(String(c.amount));
    setEditCardFrom(c.date_from);
    setEditCardTo(c.date_to);
  }
  async function saveEditCard() {
    if (!editingCardId || !hotelId) return;
    try {
      await updateCard.mutateAsync({
        id: editingCardId,
        hotelId,
        amount: parseFloat(editCardAmount),
        dateFrom: editCardFrom,
        dateTo: editCardTo,
      });
      toast.success("Registro atualizado");
      setEditingCardId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  }
  async function handleDeleteCard(id: string) {
    if (!hotelId) return;
    if (!confirm("Excluir este registro de saldo de cartão?")) return;
    try {
      await deleteCard.mutateAsync({ id, hotelId });
      toast.success("Registro removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Cabeçalho */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Gestão · Financeiro
        </p>
        <h1 className="text-2xl font-semibold">Contas a Pagar</h1>
        <p className="text-sm text-muted-foreground">
          Importe os relatórios de TOTVS ou OMIE e acompanhe os lançamentos do hotel.
        </p>
      </div>

      {/* Info do hotel */}
      {hotel && (
        <Card className="p-4 shadow-soft flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">{hotel.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sistema financeiro:</span>
            {sourceSystem ? (
              <Badge variant="outline" className="uppercase">
                {sourceSystem}
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Não configurado
              </Badge>
            )}
          </div>
          {(() => {
            const accounts = hotelFinancial?.bank_accounts ?? [];
            if (accounts.length === 0) return null;
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Contas:</span>
                {accounts.map((a, i) => (
                  <Badge key={i} variant="secondary" className="font-mono text-xs">
                    {a.bank === "itau" ? "Itaú" : "Santander"} {a.account}
                  </Badge>
                ))}
              </div>
            );
          })()}
          {!sourceSystem && (
            <p className="text-xs text-amber-600 flex items-center gap-1 w-full">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configure o sistema financeiro em{" "}
              <strong>Configurações → Hotéis</strong> antes de importar.
            </p>
          )}
        </Card>
      )}

      {showingAllHotels && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
          Vendo lançamentos de <strong className="text-foreground">todos os hotéis</strong>.
          Selecione um hotel para informar saldos e importar relatórios.
        </div>
      )}

      {true && (
        <>
          {/* Saldo bancário (Itaú + Santander) — apenas com hotel selecionado */}
          {hotelId && (
          <>
          <Card className="p-5 shadow-soft space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BankBalanceField
                bankName="itau"
                label="Saldo Itaú"
                value={balanceItauInput}
                setValue={setBalanceItauInput}
                current={balanceItau}
                disabled={!canManage}
                pending={upsertBalance.isPending}
                onSave={async () => {
                  if (!user || !balanceItauInput) return;
                  try {
                    await upsertBalance.mutateAsync({
                      hotelId,
                      amount: parseFloat(balanceItauInput),
                      userId: user.id,
                      bankName: "itau",
                    });
                    toast.success("Saldo Itaú informado");
                    setBalanceItauInput("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar saldo");
                  }
                }}
              />
              <BankBalanceField
                bankName="santander"
                label="Saldo Santander"
                value={balanceSantanderInput}
                setValue={setBalanceSantanderInput}
                current={balanceSantander}
                disabled={!canManage}
                pending={upsertBalance.isPending}
                onSave={async () => {
                  if (!user || !balanceSantanderInput) return;
                  try {
                    await upsertBalance.mutateAsync({
                      hotelId,
                      amount: parseFloat(balanceSantanderInput),
                      userId: user.id,
                      bankName: "santander",
                    });
                    toast.success("Saldo Santander informado");
                    setBalanceSantanderInput("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar saldo");
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Stat label="Saldo total (Itaú + Santander)" value={fmtBRL(balanceTotal)} />
              <Stat
                label={
                  dateFrom === dateTo
                    ? `Total a pagar em ${fmtDate(dateFrom)}`
                    : `Total a pagar ${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`
                }
                value={fmtBRL(totalToPayPeriod)}
              />
              <Stat
                label="Diferença"
                value={balanceDiffComputed !== null ? fmtBRL(balanceDiffComputed) : "—"}
                tone={balanceDiffComputed !== null && balanceDiffComputed < 0 ? "danger" : "neutral"}
              />
            </div>
          </Card>

          {/* Cartão a receber — compacto */}
          <Collapsible>
            <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                <CreditCard className="h-3.5 w-3.5 text-accent" />
                {cardReceivables[0] ? (
                  <span>
                    Cartão a receber:{" "}
                    <strong className="text-foreground">{fmtBRL(Number(cardReceivables[0].amount))}</strong>{" "}
                    ({fmtDate(cardReceivables[0].date_from)} – {fmtDate(cardReceivables[0].date_to)})
                  </span>
                ) : (
                  <span>Cartão a receber: nenhum registro</span>
                )}
              </div>
              {canManage && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                    Editar <ChevronDown className="h-3 w-3" />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
            <CollapsibleContent>
            <Card className="p-4 mt-2 shadow-soft space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Valor</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={cardAmount}
                  onChange={(e) => setCardAmount(e.target.value)}
                  onPaste={(e) => handlePasteBRL(e, setCardAmount)}
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">De</label>
                <Input type="date" value={cardFrom} onChange={(e) => setCardFrom(e.target.value)} disabled={!canManage} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Até</label>
                <Input type="date" value={cardTo} onChange={(e) => setCardTo(e.target.value)} disabled={!canManage} />
              </div>
              <Button
                size="sm"
                disabled={!canManage || !cardAmount || !cardFrom || !cardTo || upsertCard.isPending}
                onClick={async () => {
                  if (!user) return;
                  try {
                    await upsertCard.mutateAsync({
                      hotelId,
                      amount: parseFloat(cardAmount),
                      dateFrom: cardFrom,
                      dateTo: cardTo,
                      userId: user.id,
                    });
                    toast.success("Saldo de cartão registrado");
                    setCardAmount("");
                    setCardFrom("");
                    setCardTo("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar");
                  }
                }}
              >
                Salvar
              </Button>
            </div>
            {cardReceivables.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Últimos registros</p>
                <div className="space-y-1">
                  {cardReceivables.slice(0, 5).map((c) => {
                    const isEditing = editingCardId === c.id;
                    if (isEditing) {
                      return (
                        <div key={c.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center border rounded-md px-3 py-2">
                          <Input type="number" step="0.01" value={editCardAmount} onChange={(e) => setEditCardAmount(e.target.value)} className="h-8" />
                          <Input type="date" value={editCardFrom} onChange={(e) => setEditCardFrom(e.target.value)} className="h-8" />
                          <Input type="date" value={editCardTo} onChange={(e) => setEditCardTo(e.target.value)} className="h-8" />
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" className="h-8" onClick={saveEditCard} disabled={updateCard.isPending}>Salvar</Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingCardId(null)}>Cancelar</Button>
                          </div>
                        </div>
                      );
                    }
                    const ts = c.created_at
                      ? (() => {
                          const d = new Date(c.created_at);
                          const date = d.toLocaleDateString("pt-BR");
                          const time = d.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          return `${date} às ${time}`;
                        })()
                      : null;
                    return (
                      <div key={c.id} className="flex items-center justify-between text-xs border rounded-md px-3 py-1.5 gap-2">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">
                            {fmtDate(c.date_from)} → {fmtDate(c.date_to)}
                          </span>
                          {ts && <span className="text-[10px] text-muted-foreground/80">Atualizado: {ts}</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-semibold">{fmtBRL(Number(c.amount))}</span>
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditCard(c)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteCard(c.id)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </Card>
            </CollapsibleContent>
          </Collapsible>
          </>
          )}

          {/* Urgência */}
          <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
                Urgência de pagamento
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <UrgencyCell
                  label="Vencidos"
                  count={overdueCount}
                  tone="danger"
                  active={period === "overdue"}
                  onClick={() => selectUrgencyPeriod("overdue")}
                />
                <UrgencyCell label="Hoje" count={urgencyCounts.today} tone="danger" active={period === "today"} onClick={() => selectUrgencyPeriod("today")} />
                <UrgencyCell label="Amanhã" count={urgencyCounts.tomorrow} tone="warning" active={period === "tomorrow"} onClick={() => selectUrgencyPeriod("tomorrow")} />
                <UrgencyCell label="Essa semana" count={urgencyCounts.thisWeek} tone="amber" active={period === "this_week"} onClick={() => selectUrgencyPeriod("this_week")} />
                <UrgencyCell label="Sem. que vem" count={urgencyCounts.nextWeek} tone="info" active={period === "next_week"} onClick={() => selectUrgencyPeriod("next_week")} />
                <UrgencyCell label="Próx. mês" count={urgencyCounts.nextMonth} tone="muted" active={period === "next_month"} onClick={() => selectUrgencyPeriod("next_month")} />
              </div>
              {distributionEntries.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                      Distribuição de Lucros
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {distributionEntries.length} lançamento(s) — listagem separada abaixo
                    </p>
                  </div>
                  <p className="text-base font-bold">{fmtBRL(distributionTotal)}</p>
                </div>
              )}
          </Card>

          {/* Importação + filtros + tabela */}
          <Card className="p-5 shadow-soft space-y-4">
            {/* Cabeçalho do card */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider">
                  {showOmieRemoved
                    ? "Removidos do OMIE (arquivados)"
                    : showPaid
                      ? "Lançamentos pagos (arquivados)"
                      : "Lançamentos"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {showOmieRemoved
                    ? `${omieRemovedEntries.length} lançamento(s) sumiram da remessa do OMIE sem terem sido pagos`
                    : showPaid
                      ? `${paidEntries.length} lançamento(s) pago(s)`
                      : `${filtered.length} ${filtered.length === 1 ? "lançamento" : "lançamentos"} · total ${entries.length}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hotelId && (
                  <>
                    <Button
                      variant={showPaid ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setShowPaid((p) => !p);
                        setShowOmieRemoved(false);
                        setSelectedIds(new Set());
                      }}
                    >
                      {showPaid ? "Ver ativos" : "Ver pagos"}
                    </Button>
                    <Button
                      variant={showOmieRemoved ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setShowOmieRemoved((p) => !p);
                        setShowPaid(false);
                        setSelectedIds(new Set());
                      }}
                    >
                      {showOmieRemoved ? "Ver ativos" : "Removidos do OMIE"}
                    </Button>
                  </>
                )}
                {lastUpload && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Último: {fmtDateTime(lastUpload.uploaded_at)}
                  </span>
                )}
                {/* Inputs de arquivo ocultos */}
                <input
                  ref={fileRef}
                  type="file"
                  accept={acceptedExt}
                  className="hidden"
                  onChange={handleFile}
                  disabled={!canManage || !sourceSystem || uploading}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={effectiveDisplayRows.length === 0}
                  onClick={() => {
                    const data = effectiveDisplayRows.flatMap((row) => {
                      if (row.kind === "group") return [];
                      const e = row.entry;
                      return [{
                        Fornecedor: e.supplier,
                        CNPJ: e.cnpj ?? "",
                        "Nº Doc": e.document_number ?? "",
                        Vencimento: e.due_date ?? "",
                        Valor: Number(e.amount),
                        Categoria: e.category ?? "",
                        "Forma de Pagamento": e.payment_method ?? "",
                        "Aprovação GG": e.gg_approval,
                        "Status Pagamento": e.payment_status,
                        "Data do Pagamento": e.payment_paid_at
                          ? new Date(e.payment_paid_at).toLocaleDateString("pt-BR")
                          : "",
                        Observação: e.observation ?? "",
                      }];
                    });
                    const ws = XLSX.utils.json_to_sheet(data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
                    XLSX.writeFile(
                      wb,
                      `contas-a-pagar-${hotel?.name ?? "hotel"}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                    );
                  }}
                >
                  <FileDown className="h-4 w-4" /> Exportar Excel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2"
                  disabled={!canManage || !sourceSystem || uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Importar Relatório
                </Button>
              </div>
            </div>

            {showOmieRemoved && hotelId && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Estes lançamentos estavam ativos e <strong>sumiram</strong> em uma remessa do OMIE sem serem marcados como pagos.
                  Use "Restaurar" se quiser reincluí-los na lista de ativos.
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fornecedor</TableHead>
                        <TableHead>Nº Doc</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status anterior</TableHead>
                        <TableHead>Removido em</TableHead>
                        <TableHead>Remessa</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {omieRemovedEntries.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-6">
                            Nenhum lançamento removido do OMIE.
                          </TableCell>
                        </TableRow>
                      )}
                      {omieRemovedEntries.map((e) => {
                        const upload = (e as { archived_upload?: { file_name: string | null; uploaded_at: string | null } | null }).archived_upload;
                        return (
                          <TableRow key={e.id}>
                            <TableCell>
                              <div className="font-medium">{e.supplier}</div>
                              {e.cnpj && <div className="text-[11px] text-muted-foreground">{e.cnpj}</div>}
                            </TableCell>
                            <TableCell className="text-xs">{e.document_number ?? "—"}</TableCell>
                            <TableCell className="text-xs">{e.due_date ? fmtDate(e.due_date) : "—"}</TableCell>
                            <TableCell className="text-right text-xs">{fmtBRL(Number(e.amount))}</TableCell>
                            <TableCell><PaymentStatusBadge status={e.payment_status} /></TableCell>
                            <TableCell className="text-xs">{e.archived_at ? fmtDateTime(e.archived_at) : "—"}</TableCell>
                            <TableCell className="text-xs">
                              {upload?.file_name ?? "—"}
                              {upload?.uploaded_at && (
                                <div className="text-[11px] text-muted-foreground">{fmtDateTime(upload.uploaded_at)}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {canManage ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={restoreApEntry.isPending}
                                  onClick={async () => {
                                    try {
                                      await restoreApEntry.mutateAsync({ id: e.id, hotelId });
                                      toast.success("Lançamento restaurado para ativos");
                                    } catch (err: any) {
                                      toast.error(err?.message ?? "Falha ao restaurar");
                                    }
                                  }}
                                >
                                  Restaurar
                                </Button>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">sem permissão</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {!showOmieRemoved && (
            <>
            {/* Filtros (sticky) */}
            <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-5 px-5 pt-2 pb-3 border-b space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Buscar fornecedor, CNPJ, nº documento ou valor..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os períodos</SelectItem>
                  <SelectItem value="overdue">Vencidos</SelectItem>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="tomorrow">Amanhã</SelectItem>
                  <SelectItem value="this_week">Essa semana</SelectItem>
                  <SelectItem value="next_week">Semana que vem</SelectItem>
                  <SelectItem value="next_month">Próximo mês</SelectItem>
                </SelectContent>
              </Select>

              {(() => {
                const STATUS_OPTIONS: { value: string; label: string }[] = [
                  { value: "nao_aprovado_gg", label: "Não aprovado pelo GG" },
                  { value: "em_aprovacao", label: "Em Aprovação" },
                  { value: "autorizado", label: "Autorizado" },
                  { value: "agendado", label: "Agendado" },
                  { value: "pago", label: "Pago" },
                  { value: "pago_parcialmente", label: "Pago Parcialmente" },
                  { value: "pendente", label: "Pendente (flag)" },
                ];
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="justify-between h-10">
                        <span>
                          Status{selectedStatuses.length > 0 ? ` (${selectedStatuses.length})` : ""}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 bg-popover">
                      <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {STATUS_OPTIONS.map((opt) => (
                        <DropdownMenuCheckboxItem
                          key={opt.value}
                          checked={selectedStatuses.includes(opt.value)}
                          onCheckedChange={(c) =>
                            setSelectedStatuses((prev) =>
                              c ? [...prev, opt.value] : prev.filter((s) => s !== opt.value),
                            )
                          }
                          onSelect={(e) => e.preventDefault()}
                        >
                          {opt.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {selectedStatuses.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-7 px-2 text-xs"
                            onClick={() => setSelectedStatuses([])}
                          >
                            Limpar
                          </Button>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}

              {sourceSystem === "omie" ? (() => {
                const FIXED_CATEGORIES = ["Salários RH"];
                const allCategories = [
                  ...FIXED_CATEGORIES,
                  ...categories.filter((c) => !FIXED_CATEGORIES.includes(c)),
                ];
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="justify-between h-10">
                        <span>
                          Categoria{selectedCategories.length > 0 ? ` (${selectedCategories.length})` : ""}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64 max-h-[320px] overflow-y-auto bg-popover">
                      <DropdownMenuLabel className="text-xs">Categoria</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {allCategories.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c}
                          checked={selectedCategories.includes(c)}
                          onCheckedChange={(chk) =>
                            setSelectedCategories((prev) =>
                              chk ? [...prev, c] : prev.filter((x) => x !== c),
                            )
                          }
                          onSelect={(e) => e.preventDefault()}
                        >
                          {c}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {selectedCategories.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-7 px-2 text-xs"
                            onClick={() => setSelectedCategories([])}
                          >
                            Limpar
                          </Button>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })() : (
                <div />
              )}
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Agendado de</span>
                <Input
                  type="date"
                  className="h-7 w-[140px] text-xs"
                  value={scheduledFrom}
                  onChange={(e) => setScheduledFrom(e.target.value)}
                />
                <span className="text-muted-foreground">até</span>
                <Input
                  type="date"
                  className="h-7 w-[140px] text-xs"
                  value={scheduledTo}
                  onChange={(e) => setScheduledTo(e.target.value)}
                />
                {(scheduledFrom || scheduledTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => { setScheduledFrom(""); setScheduledTo(""); }}
                  >
                    Limpar
                  </Button>
                )}
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={hideTrivial} onCheckedChange={(c) => setHideTrivial(!!c)} />
                Ocultar lançamentos abaixo de R$ 1,00
              </label>
            </div>

            {(() => {
              const activeFilterCount = [
                period !== "all",
                selectedStatuses.length > 0,
                selectedCategories.length > 0,
                searchText !== "",
                !hideTrivial,
              ].filter(Boolean).length;
              const hasActiveFilters = activeFilterCount > 0;
              if (!hasActiveFilters) return null;
              return (
                <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-accent" />
                    <span className="text-accent font-medium">
                      {activeFilterCount} filtro{activeFilterCount !== 1 ? "s" : ""} ativo
                      {activeFilterCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      · mostrando {filtered.length} de {entries.length} lançamentos
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-accent hover:text-accent"
                    onClick={() => {
                      setPeriod("all");
                      setSelectedStatuses([]);
                      setSelectedCategories([]);
                      setSearchText("");
                      setHideTrivial(true);
                    }}
                  >
                    Limpar filtros
                  </Button>
                </div>
              );
            })()}
            </div>

            {/* Tabela */}
            <div className="border rounded-md overflow-hidden">
              {/* Barra de ações em lote */}
              {(canMarkInsertedAgendado || canMarkPaid) && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b bg-muted/30 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} selecionado(s) · soma ${fmtBRL(selectedTotal)}`
                      : "Selecione lançamentos para marcar status em lote"}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedIds.size > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-8"
                        onClick={() => setNotifyOpen(true)}
                      >
                        <Mail className="h-3.5 w-3.5" /> Notificar GG ({selectedIds.size})
                      </Button>
                    )}
                    {canMarkAutorizado && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-8 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-400"
                        disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                        onClick={() => handleBulkPaymentStatus("autorizado")}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Autorizado
                      </Button>
                    )}
                    {canMarkInsertedAgendado && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 h-8"
                          disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                          onClick={() => handleBulkPaymentStatus("agendado")}
                        >
                          <CalendarClock className="h-3.5 w-3.5" /> Agendado
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 h-8 border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-400"
                          disabled={selectedIds.size === 0 || unscheduleEntries.isPending}
                          onClick={handleBulkUnschedule}
                          title="Voltar agendados para 'Em Aprovação' e limpar a data agendada"
                        >
                          <CalendarX className="h-3.5 w-3.5" /> Desagendar
                        </Button>
                      </>
                    )}
                    {selectedIds.size > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-8 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                        disabled={setPending.isPending}
                        onClick={handleBulkPending}
                        title="Marcar/desmarcar como Pendente (paralelo ao status atual)"
                      >
                        <Clock className="h-3.5 w-3.5" /> Pendente
                      </Button>
                    )}
                    {canMarkPaid && (
                      <Button
                        size="sm"
                        className="gap-1 h-8"
                        disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                        onClick={() => handleBulkPaymentStatus("pago")}
                      >
                        <Banknote className="h-3.5 w-3.5" /> Marcar Pago
                      </Button>
                    )}
                    {selectedIds.size > 0 && canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={updateCategory.isPending}
                        onClick={() => handleBulkCategory("Salários RH")}
                      >
                        Salários RH
                      </Button>
                    )}
                    {selectedIds.size > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        Limpar
                      </Button>
                    )}
                    {canManage && selectedIds.size > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => setGroupDialogOpen(true)}
                      >
                        Agrupar selecionados
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    {(canMarkInsertedAgendado || canMarkPaid) && (
                      <TableHead className="w-8">
                        <Checkbox
                          checked={
                            effectiveDisplayRows.length > 0 &&
                            effectiveDisplayRows
                              .filter((r) => r.kind === "single")
                              .every((r) => selectedIds.has((r as { entry: ApEntry }).entry.id))
                          }
                          onCheckedChange={(c) => toggleSelectAllVisible(!!c)}
                          aria-label="Selecionar todos visíveis"
                        />
                      </TableHead>
                    )}
                    {showingAllHotels && <TableHead>Hotel</TableHead>}
                    <TableHead>Fornecedor</TableHead>
                    {sourceSystem === "omie" && <TableHead className="hidden md:table-cell">CNPJ</TableHead>}
                    <TableHead className="hidden md:table-cell">Nº Doc</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("due_date")}>
                      Vencimento {sortIndicator("due_date")}
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("amount")}>
                      Valor {sortIndicator("amount")}
                    </TableHead>
                    {showOriginalAmount && <TableHead className="text-right hidden lg:table-cell">Valor Original</TableHead>}
                    {showPaidAmount     && <TableHead className="text-right hidden lg:table-cell">Valor Novo</TableHead>}
                    {showPaidInterest   && <TableHead className="text-right hidden lg:table-cell">Juros / Desc.</TableHead>}
                    <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                    {sourceSystem === "omie" && <TableHead className="hidden lg:table-cell">Conta</TableHead>}
                    {showApproval && <TableHead>Aprovação GG</TableHead>}
                    <TableHead className="hidden md:table-cell">Agendado para</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesLoading ? (
                    <TableSkeleton
                      rows={8}
                      cols={(showApproval ? 11 : 10) + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0) + (sourceSystem === "omie" ? 2 : 0) + (showingAllHotels ? 1 : 0) - (showOriginalAmount ? 0 : 1) - (showPaidAmount ? 0 : 1) - (showPaidInterest ? 0 : 1)}
                    />
                  ) : effectiveDisplayRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={(showApproval ? 11 : 10) + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0) + (sourceSystem === "omie" ? 2 : 0) + (showingAllHotels ? 1 : 0) - (showOriginalAmount ? 0 : 1) - (showPaidAmount ? 0 : 1) - (showPaidInterest ? 0 : 1)}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Nenhum lançamento encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    effectiveDisplayRows.map((row, idx) => {
                      if (row.kind === "group") {
                        const colSpan =
                          (showApproval ? 11 : 10) +
                          (sourceSystem === "omie" ? 2 : 0) +
                          ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0) +
                          (showingAllHotels ? 1 : 0) -
                          (showOriginalAmount ? 0 : 1) -
                          (showPaidAmount ? 0 : 1) -
                          (showPaidInterest ? 0 : 1);
                        return (
                          <TableRow key={`g-${idx}`} className="bg-muted/30">
                            {(canMarkInsertedAgendado || canMarkPaid) && (
                              <TableCell />
                            )}
                            {showingAllHotels && <TableCell />}
                            <TableCell className="font-medium">
                              {row.supplier}{" "}
                              <span className="text-muted-foreground font-normal">
                                ({row.entries.length})
                              </span>
                            </TableCell>
                            {sourceSystem === "omie" && (
                              <TableCell className="text-xs text-muted-foreground">—</TableCell>
                            )}
                            <TableCell className="text-xs text-muted-foreground italic">
                              N/D agrupado
                            </TableCell>
                            <TableCell className="text-xs">
                              {row.due
                                ? (() => {
                                    const [y, m, d] = row.due.split("-");
                                    return `${d}/${m}/${y}`;
                                  })()
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {fmtBRL(row.amount)}
                            </TableCell>
                            <TableCell
                              className="text-xs text-muted-foreground"
                              colSpan={colSpan - (sourceSystem === "omie" ? 5 : 4)}
                            >
                              {row.entries.length} lançamento(s) sem nº de documento
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const e = row.entry;
                      return (
                        <ApEntryRow
                          key={e.id}
                          entry={e}
                          sourceSystem={sourceSystem}
                          showApproval={showApproval}
                          selectable={canMarkInsertedAgendado || canMarkPaid}
                          selected={selectedIds.has(e.id)}
                          onToggleSelected={(v) => toggleSelected(e.id, v)}
                          showBank={sourceSystem === "omie"}
                          canEditObservation={canManage}
                          canManageCategory={canManage}
                          canManage={canManage}
                          hotelLabel={showingAllHotels ? (hotelNameById.get(e.hotel_id) ?? e.hotel_id) : undefined}
                          showOriginalAmount={showOriginalAmount}
                          showPaidAmount={showPaidAmount}
                          showPaidInterest={showPaidInterest}
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Histórico de notificações */}
            {notifLog.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs font-semibold uppercase tracking-wider cursor-pointer text-muted-foreground hover:text-foreground">
                  Histórico de notificações ({notifLog.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {notifLog.map((log) => (
                    <div key={log.id} className="text-sm border rounded-md p-3">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{fmtDateTime(log.sent_at)}</span>
                        <span>{log.recipient_emails.join(", ") || "—"}</span>
                      </div>
                      {log.message_text && (
                        <p className="text-xs whitespace-pre-wrap">{log.message_text}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {(log.entries_snapshot as unknown[]).length} lançamento(s) notificado(s)
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            </>
            )}
          </Card>
        </>
      )}

      {/* Tabela de Salários RH */}
      {hotelId && salaryEntries.length > 0 && (
        <Card className="p-5 shadow-soft space-y-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              Salários RH
            </h3>
            <p className="text-xs text-muted-foreground">
              {salaryEntries.length} lançamento(s) · total {fmtBRL(
                salaryEntries.reduce((s, e) => s + Number(e.amount ?? 0), 0),
              )}
            </p>
          </div>
          {(canMarkInsertedAgendado || canMarkPaid) && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 border rounded-md bg-muted/30 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {Array.from(selectedIds).filter((id) => salaryEntries.some((e) => e.id === id)).length > 0
                  ? `${Array.from(selectedIds).filter((id) => salaryEntries.some((e) => e.id === id)).length} selecionado(s)`
                  : "Selecione salários para marcar status em lote"}
              </div>
              <div className="flex items-center gap-2">
                {canMarkAutorizado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-400"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("autorizado")}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Autorizado
                  </Button>
                )}
                {canMarkInsertedAgendado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("agendado")}
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> Agendado
                  </Button>
                )}
                {canMarkInsertedAgendado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-400"
                    disabled={selectedIds.size === 0 || unscheduleEntries.isPending}
                    onClick={handleBulkUnschedule}
                  >
                    <CalendarX className="h-3.5 w-3.5" /> Desagendar
                  </Button>
                )}
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    disabled={setPending.isPending}
                    onClick={handleBulkPending}
                  >
                    <Clock className="h-3.5 w-3.5" /> Pendente
                  </Button>
                )}
                {canMarkPaid && (
                  <Button
                    size="sm"
                    className="gap-1 h-8"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("pago")}
                  >
                    <Banknote className="h-3.5 w-3.5" /> Marcar Pago
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {(canMarkInsertedAgendado || canMarkPaid) && (
                    <TableHead className="w-8">
                      <Checkbox
                        checked={
                          salaryEntries.length > 0 &&
                          salaryEntries.every((e) => selectedIds.has(e.id))
                        }
                        onCheckedChange={(c) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (c) salaryEntries.forEach((e) => next.add(e.id));
                            else salaryEntries.forEach((e) => next.delete(e.id));
                            return next;
                          });
                        }}
                        aria-label="Selecionar todos salários"
                      />
                    </TableHead>
                  )}
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="hidden md:table-cell">Nº Doc</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                  <TableHead className="hidden md:table-cell">Agendado para</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaryEntries.map((e) => (
                  <ApEntryRow
                    key={e.id}
                    entry={e}
                    sourceSystem={sourceSystem}
                    showApproval={false}
                    selectable={canMarkInsertedAgendado || canMarkPaid}
                    selected={selectedIds.has(e.id)}
                    onToggleSelected={(v) => toggleSelected(e.id, v)}
                    showBank={false}
                    canEditObservation={canManage}
                    canManageCategory={canManage}
                    canManage={canManage}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Tabela de Distribuição de Lucros */}
      {hotelId && distributionEntries.length > 0 && (
        <Card className="p-5 shadow-soft space-y-3 border-accent/40">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-accent">
              Distribuição de Lucros — Sócios
            </h3>
            <p className="text-xs text-muted-foreground">
              {filteredDistribution.length} de {distributionEntries.length} lançamento(s) · total {fmtBRL(distributionTotal)}
            </p>
          </div>
          {/* Barra de ações em lote (distribuição) */}
          {(canMarkInsertedAgendado || canMarkPaid) && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 border rounded-md bg-muted/30 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {Array.from(selectedIds).filter((id) => filteredDistribution.some((e) => e.id === id)).length > 0
                  ? `${Array.from(selectedIds).filter((id) => filteredDistribution.some((e) => e.id === id)).length} selecionado(s) na distribuição`
                  : "Selecione sócios para marcar status em lote"}
              </div>
              <div className="flex items-center gap-2">
                {canMarkAutorizado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-400"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("autorizado")}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Autorizado
                  </Button>
                )}
                {canMarkInsertedAgendado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("agendado")}
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> Agendado
                  </Button>
                )}
                {canMarkInsertedAgendado && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-400"
                    disabled={selectedIds.size === 0 || unscheduleEntries.isPending}
                    onClick={handleBulkUnschedule}
                  >
                    <CalendarX className="h-3.5 w-3.5" /> Desagendar
                  </Button>
                )}
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-8 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    disabled={setPending.isPending}
                    onClick={handleBulkPending}
                  >
                    <Clock className="h-3.5 w-3.5" /> Pendente
                  </Button>
                )}
                {canMarkPaid && (
                  <Button
                    size="sm"
                    className="gap-1 h-8"
                    disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                    onClick={() => handleBulkPaymentStatus("pago")}
                  >
                    <Banknote className="h-3.5 w-3.5" /> Marcar Pago
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {(canMarkInsertedAgendado || canMarkPaid) && (
                    <TableHead className="w-8">
                      <Checkbox
                        checked={
                          filteredDistribution.length > 0 &&
                          filteredDistribution.every((e) => selectedIds.has(e.id))
                        }
                        onCheckedChange={(c) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (c) filteredDistribution.forEach((e) => next.add(e.id));
                            else filteredDistribution.forEach((e) => next.delete(e.id));
                            return next;
                          });
                        }}
                        aria-label="Selecionar todos sócios"
                      />
                    </TableHead>
                  )}
                  <TableHead>Fornecedor / Sócio</TableHead>
                  <TableHead className="hidden md:table-cell">CPF / CNPJ</TableHead>
                  <TableHead className="hidden md:table-cell">Nº Doc</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  {showOriginalAmount && <TableHead className="text-right hidden lg:table-cell">Valor Original</TableHead>}
                  {showPaidAmount     && <TableHead className="text-right hidden lg:table-cell">Valor Novo</TableHead>}
                  {showPaidInterest   && <TableHead className="text-right hidden lg:table-cell">Juros / Desc.</TableHead>}
                  <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                  <TableHead className="hidden md:table-cell">Agendado para</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDistribution.map((e) => (
                  <ApEntryRow
                    key={e.id}
                    entry={e}
                    sourceSystem="omie"
                    showApproval={false}
                    isDistribution
                    selectable={canMarkInsertedAgendado || canMarkPaid}
                    selected={selectedIds.has(e.id)}
                    onToggleSelected={(v) => toggleSelected(e.id, v)}
                    showBank={false}
                    canEditObservation={canManage}
                    canManageCategory={false}
                    showOriginalAmount={showOriginalAmount}
                    showPaidAmount={showPaidAmount}
                    showPaidInterest={showPaidInterest}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Modal de notificação ao GG */}
      {hotelId && (
        <NotifyGgDialog
          open={notifyOpen}
          onClose={() => setNotifyOpen(false)}
          hotelId={hotelId}
          selectedEntries={
            selectedIds.size > 0
              ? entries.filter((e) => selectedIds.has(e.id))
              : issueEntries
          }
        />
      )}

      <AlertDialog
        open={reimportConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setReimportConfirmOpen(false);
            setPendingFile(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir lançamentos existentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existem <strong>{entries.length}</strong> lançamentos importados para este hotel.
              O novo arquivo vai atualizar os dados existentes — status de pagamento e aprovações
              já registrados serão preservados. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setReimportConfirmOpen(false);
                if (pendingFile) executeUpload(pendingFile);
              }}
            >
              Continuar importação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de agendamento */}
      <AlertDialog open={schedulingOpen} onOpenChange={setSchedulingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Data de agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              Selecione a data prevista de pagamento. Se houver juros ou desconto,
              ajuste o valor abaixo — o sistema reconhece automaticamente a diferença.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                Data de agendamento
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                Valor a pagar (ajuste se houver juros ou desconto)
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder={fmtBRL(selectedTotal)}
                value={scheduledPaidAmount}
                onChange={(e) => setScheduledPaidAmount(e.target.value)}
                onPaste={(e) => handlePasteBRL(e, setScheduledPaidAmount)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Valor original: <strong>{fmtBRL(selectedTotal)}</strong>
              </p>
              {scheduledPaidAmount && !Number.isNaN(parseFloat(scheduledPaidAmount)) && (() => {
                const diff = parseFloat(scheduledPaidAmount) - selectedTotal;
                if (Math.abs(diff) < 0.005) return null;
                if (diff > 0) {
                  return (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                      Juros calculados: <strong>{fmtBRL(diff)}</strong>
                    </p>
                  );
                }
                return (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                    Desconto calculado: <strong>{fmtBRL(Math.abs(diff))}</strong>
                  </p>
                );
              })()}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!scheduledDate}
              onClick={() => {
                setSchedulingOpen(false);
                const paidNum = scheduledPaidAmount ? parseFloat(scheduledPaidAmount) : NaN;
                const hasPaid = !Number.isNaN(paidNum);
                const diff = hasPaid ? paidNum - selectedTotal : 0;
                // Só persiste paid_amount/paid_interest quando há diferença real
                // (juros ou desconto). Caso contrário mantém os campos nulos.
                const hasDelta = hasPaid && Math.abs(diff) >= 0.005;
                executeStatusChange("agendado", {
                  scheduledDate,
                  paidAmount: hasDelta ? paidNum : undefined,
                  paidInterest: hasDelta ? diff : undefined,
                });
              }}
            >
              Confirmar agendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de agrupamento de lançamentos */}
      <AlertDialog
        open={groupDialogOpen}
        onOpenChange={(o) => {
          setGroupDialogOpen(o);
          if (!o) setGroupCategoryName("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agrupar lançamentos</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.size} lançamentos serão agrupados em um único lançamento.
              Valor total: <strong>{fmtBRL(selectedTotal)}</strong>.
              Os originais serão arquivados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              autoFocus
              placeholder="Nome da categoria (ex: Comissões Maio)"
              value={groupCategoryName}
              onChange={(e) => setGroupCategoryName(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!groupCategoryName.trim() || groupEntries.isPending || !hotelId}
              onClick={async (e) => {
                e.preventDefault();
                if (!hotelId) return;
                try {
                  await groupEntries.mutateAsync({
                    hotelId,
                    entryIds: Array.from(selectedIds),
                    categoryName: groupCategoryName.trim(),
                  });
                  toast.success("Lançamentos agrupados com sucesso");
                  setSelectedIds(new Set());
                  setGroupCategoryName("");
                  setGroupDialogOpen(false);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Erro ao agrupar lançamentos",
                  );
                }
              }}
            >
              {groupEntries.isPending ? "Agrupando..." : "Agrupar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sub-componentes ─────────────────────────────────────────────────────
interface BankBalanceFieldProps {
  bankName: "itau" | "santander";
  label: string;
  value: string;
  setValue: (v: string) => void;
  current: { amount: number | string; updated_at: string } | null | undefined;
  disabled: boolean;
  pending: boolean;
  onSave: () => void;
}
function BankBalanceField({ label, value, setValue, current, disabled, pending, onSave }: BankBalanceFieldProps) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          placeholder={current ? String(current.amount) : "0,00"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => handlePasteBRL(e, setValue)}
          disabled={disabled}
        />
        <Button size="sm" disabled={disabled || !value || pending} onClick={onSave}>
          Salvar
        </Button>
      </div>
      {current ? (
        <p className="text-[11px] text-muted-foreground mt-1">
          Atual: {fmtBRL(Number(current.amount))} · {fmtDateTime(current.updated_at)}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground mt-1">Nenhum saldo informado hoje</p>
      )}
    </div>
  );
}
