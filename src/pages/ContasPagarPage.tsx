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
import { AlertTriangle, Banknote, Building2, CalendarClock, CheckCircle2, CreditCard, FileDown, FileSpreadsheet, Filter, Loader2, Mail, Search, ShieldCheck, Upload, Wallet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useAllHotels, type HotelRow } from "@/hooks/useHotelAssets";
import {
  uploadApReport,
  useApEntries,
  useLatestApUpload,
  useSetEntryPaymentStatus,
  useTodayBankBalance,
  useUpsertBankBalance,
  useApNotificationLog,
  useCardReceivable,
  useUpsertCardReceivable,
  type ApEntry,
  type ApPaymentStatus,
  type FinancialSystem,
} from "@/hooks/useAccountsPayable";
import { useApPageDerived } from "@/hooks/useApPageDerived";
import type { Period, StatusFilter } from "@/lib/apPeriodFilter";
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
  // Marcações em lote — equipe pode marcar Inserido/Agendado; só coordenadora/master pode Pago.
  const canMarkInsertedAgendado =
    isMaster || isFinanceiroEquipe || isFinanceiroCoordenadora;
  const canMarkPaid = !isFernando && (isMaster || isFinanceiroCoordenadora);
  const canMarkAutorizado = !isFernando && (isMaster || isFinanceiroCoordenadora);
  const isGg = hasRole("gg");
  const canApproveBase = canManage || isGg;

  const { data: hotels = [] } = useAllHotels();
  const { hotelId, dateFrom, dateTo } = useModuleFilters("financeiro");
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
  const { data: allEntriesRaw = [], isLoading: entriesLoading } = useApEntries(hotelId);
  const { data: balanceItau } = useTodayBankBalance(hotelId, "itau");
  const { data: balanceSantander } = useTodayBankBalance(hotelId, "santander");
  const { data: cardReceivables = [] } = useCardReceivable(hotelId);
  const { data: notifLog = [] } = useApNotificationLog(hotelId);

  // ── Mutations ──────────────────────────────────────────────────────────
  const upsertBalance = useUpsertBankBalance();
  const setPaymentStatus = useSetEntryPaymentStatus();
  const upsertCard = useUpsertCardReceivable();

  // ── Estado local ───────────────────────────────────────────────────────
  const [balanceItauInput, setBalanceItauInput] = useState("");
  const [balanceSantanderInput, setBalanceSantanderInput] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [cardFrom, setCardFrom] = useState("");
  const [cardTo, setCardTo] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [hideTrivial, setHideTrivial] = useState(true);
  const [groupNd, setGroupNd] = useState(true);
  const [searchText, setSearchText] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reimportConfirmOpen, setReimportConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledPaidAmount, setScheduledPaidAmount] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Derivações ─────────────────────────────────────────────────────────
  const derived = useApPageDerived({
    allEntriesRaw,
    documents: [],
    balance: balanceItau,
    sourceSystem,
    period,
    status,
    category,
    hideTrivial,
    groupNd,
    showApproval,
    hotelCnpj: (hotel as { cnpj?: string | null } | null)?.cnpj ?? null,
    searchText,
    dateFrom,
    dateTo,
  });

  const {
    entries,
    distributionEntries,
    filtered,
    displayRows,
    categories,
    urgencyCounts,
    issueCounts,
    issueEntries,
    totalToPayPeriod,
    distributionTotal,
    balanceDiff,
  } = derived;

  const balanceItauAmount = balanceItau ? Number(balanceItau.amount) : null;
  const balanceSantanderAmount = balanceSantander ? Number(balanceSantander.amount) : null;
  const balanceTotal =
    (balanceItauAmount ?? 0) + (balanceSantanderAmount ?? 0);
  const acceptedExt = sourceSystem === "totvs" ? ".xls" : ".xlsx,.zip";

  // Soma da seleção em lote
  const selectedTotal = useMemo(() => {
    let sum = 0;
    for (const e of entries) if (selectedIds.has(e.id)) sum += Number(e.amount ?? 0);
    for (const e of distributionEntries) if (selectedIds.has(e.id)) sum += Number(e.amount ?? 0);
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
      toast.success(
        `Importado: ${r.entries} lançamentos${r.documents_extracted ? `, ${r.documents_extracted} documentos` : ""}`,
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
      setScheduledPaidAmount("");
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
      const visibleIds = displayRows.flatMap((r) => (r.kind === "single" ? [r.entry.id] : []));
      if (checked) visibleIds.forEach((id) => next.add(id));
      else visibleIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function labelForStatus(s: ApPaymentStatus) {
    return s === "pago"
      ? "Pago"
      : s === "agendado"
      ? "Agendado"
      : s === "autorizado"
      ? "Autorizado"
      : "Em Aprovação";
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
          {!sourceSystem && (
            <p className="text-xs text-amber-600 flex items-center gap-1 w-full">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configure o sistema financeiro em{" "}
              <strong>Configurações → Hotéis</strong> antes de importar.
            </p>
          )}
        </Card>
      )}

      {/* Placeholder sem hotel */}
      {!hotelId && (
        <EmptyHotelState
          icon={<Wallet className="h-12 w-12" />}
          title="Contas a Pagar"
          description="Selecione um hotel para visualizar e gerenciar os lançamentos financeiros."
        />
      )}

      {hotelId && (
        <>
          {/* Saldo bancário (Itaú + Santander) */}
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
                value={balanceDiff !== null ? fmtBRL(balanceDiff) : "—"}
                tone={balanceDiff !== null && balanceDiff < 0 ? "danger" : "neutral"}
              />
            </div>
          </Card>

          {/* Cartão a receber */}
          <Card className="p-5 shadow-soft space-y-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Cartão a receber</h3>
            </div>
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
                  {cardReceivables.slice(0, 5).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs border rounded-md px-3 py-1.5">
                      <span className="text-muted-foreground">
                        {fmtDate(c.date_from)} → {fmtDate(c.date_to)}
                      </span>
                      <span className="font-mono font-semibold">{fmtBRL(Number(c.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Urgência */}
          <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
                Urgência de pagamento
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <UrgencyCell
                  label="Vencidos"
                  count={entries.filter((e) => isWithinPeriod(e.due_date, "overdue")).length}
                  tone="danger"
                  active={period === "overdue"}
                  onClick={() => setPeriod(period === "overdue" ? "all" : "overdue")}
                />
                <UrgencyCell label="Hoje" count={urgencyCounts.today} tone="danger" active={period === "today"} onClick={() => setPeriod(period === "today" ? "all" : "today")} />
                <UrgencyCell label="Amanhã" count={urgencyCounts.tomorrow} tone="warning" active={period === "tomorrow"} onClick={() => setPeriod(period === "tomorrow" ? "all" : "tomorrow")} />
                <UrgencyCell label="Essa semana" count={urgencyCounts.thisWeek} tone="amber" active={period === "this_week"} onClick={() => setPeriod(period === "this_week" ? "all" : "this_week")} />
                <UrgencyCell label="Sem. que vem" count={urgencyCounts.nextWeek} tone="info" active={period === "next_week"} onClick={() => setPeriod(period === "next_week" ? "all" : "next_week")} />
                <UrgencyCell label="Próx. mês" count={urgencyCounts.nextMonth} tone="muted" active={period === "next_month"} onClick={() => setPeriod(period === "next_month" ? "all" : "next_month")} />
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
                <h3 className="text-sm font-semibold uppercase tracking-wider">Lançamentos</h3>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "lançamento" : "lançamentos"} · total{" "}
                  {entries.length}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
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
                  disabled={displayRows.length === 0}
                  onClick={() => {
                    const data = displayRows.flatMap((row) => {
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

            {/* Filtros */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Buscar fornecedor, CNPJ ou nº documento…"
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

              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="issues">Sem aprovação do GG</SelectItem>
                  <SelectItem value="payment_inserido">Inserido no banco</SelectItem>
                  <SelectItem value="payment_agendado">Agendado</SelectItem>
                  <SelectItem value="payment_pago">Pago</SelectItem>
                  <SelectItem value="payment_pendente">Em Aprovação</SelectItem>
                </SelectContent>
              </Select>

              {sourceSystem === "omie" && categories.length > 0 ? (
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div />
              )}
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={hideTrivial} onCheckedChange={(c) => setHideTrivial(!!c)} />
                Ocultar lançamentos abaixo de R$ 1,00
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={groupNd} onCheckedChange={(c) => setGroupNd(!!c)} />
                Agrupar lançamentos N/D do mesmo fornecedor e data
              </label>
            </div>

            {(() => {
              const activeFilterCount = [
                period !== "all",
                status !== "all",
                category !== "all",
                searchText !== "",
                !hideTrivial,
              ].filter(Boolean).length;
              const hasActiveFilters = activeFilterCount > 0 || !groupNd;
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
                      setStatus("all");
                      setCategory("all");
                      setSearchText("");
                      setHideTrivial(true);
                      setGroupNd(true);
                    }}
                  >
                    Limpar filtros
                  </Button>
                </div>
              );
            })()}

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
                          onClick={() => handleBulkPaymentStatus("inserido")}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Inserido no banco
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 h-8"
                          disabled={selectedIds.size === 0 || setPaymentStatus.isPending}
                          onClick={() => handleBulkPaymentStatus("agendado")}
                        >
                          <CalendarClock className="h-3.5 w-3.5" /> Agendado
                        </Button>
                      </>
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
                            displayRows.length > 0 &&
                            displayRows
                              .filter((r) => r.kind === "single")
                              .every((r) => selectedIds.has((r as { entry: ApEntry }).entry.id))
                          }
                          onCheckedChange={(c) => toggleSelectAllVisible(!!c)}
                          aria-label="Selecionar todos visíveis"
                        />
                      </TableHead>
                    )}
                    <TableHead>Fornecedor</TableHead>
                    {sourceSystem === "omie" && <TableHead className="hidden md:table-cell">CNPJ</TableHead>}
                    <TableHead className="hidden md:table-cell">Nº Doc</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                    {sourceSystem === "omie" && <TableHead className="hidden lg:table-cell">Conta</TableHead>}
                    {showApproval && <TableHead>Aprovação GG</TableHead>}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesLoading ? (
                    <TableSkeleton
                      rows={8}
                      cols={(showApproval ? 7 : 6) + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0) + (sourceSystem === "omie" ? 2 : 0)}
                    />
                  ) : displayRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={(showApproval ? 7 : 6) + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0) + (sourceSystem === "omie" ? 2 : 0)}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Nenhum lançamento encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayRows.map((row, idx) => {
                      if (row.kind === "group") {
                        const colSpan =
                          (showApproval ? 7 : 6) +
                          (sourceSystem === "omie" ? 2 : 0) +
                          ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0);
                        return (
                          <TableRow key={`g-${idx}`} className="bg-muted/30">
                            {(canMarkInsertedAgendado || canMarkPaid) && (
                              <TableCell />
                            )}
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
          </Card>
        </>
      )}

      {/* Tabela de Distribuição de Lucros */}
      {hotelId && distributionEntries.length > 0 && (
        <Card className="p-5 shadow-soft space-y-3 border-accent/40">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-accent">
              Distribuição de Lucros — Sócios
            </h3>
            <p className="text-xs text-muted-foreground">
              {distributionEntries.length} lançamento(s) · total {fmtBRL(distributionTotal)}
            </p>
          </div>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {(canMarkInsertedAgendado || canMarkPaid) && (
                    <TableHead className="w-8">
                      <Checkbox
                        checked={
                          distributionEntries.length > 0 &&
                          distributionEntries.every((e) => selectedIds.has(e.id))
                        }
                        onCheckedChange={(c) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (c) distributionEntries.forEach((e) => next.add(e.id));
                            else distributionEntries.forEach((e) => next.delete(e.id));
                            return next;
                          });
                        }}
                        aria-label="Selecionar todos sócios"
                      />
                    </TableHead>
                  )}
                  <TableHead>Fornecedor / Sócio</TableHead>
                  <TableHead className="hidden md:table-cell">CPF / CNPJ</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributionEntries.map((e) => {
                  const isSelected = selectedIds.has(e.id);
                  const rowBg =
                    e.payment_status === "pago"
                      ? "bg-emerald-500/10"
                      : e.payment_status === "inserido"
                      ? "bg-sky-500/10"
                      : e.payment_status === "agendado"
                      ? "bg-violet-500/10"
                      : "";
                  return (
                    <TableRow key={e.id} className={rowBg}>
                      {(canMarkInsertedAgendado || canMarkPaid) && (
                        <TableCell className="w-8">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(c) => toggleSelected(e.id, !!c)}
                            aria-label="Selecionar sócio"
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{e.supplier}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                        {e.cnpj ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(e.due_date)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {fmtBRL(Number(e.amount))}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={e.payment_status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
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
              Selecione a data prevista para inserção no banco. O sistema mudará automaticamente
              para "Inserido" nessa data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!scheduledDate}
              onClick={() => {
                setSchedulingOpen(false);
                executeStatusChange("agendado", { scheduledDate });
              }}
            >
              Confirmar agendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de juros (lançamentos vencidos marcados como Inserido) */}
      <AlertDialog open={interestDialogOpen} onOpenChange={setInterestDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Há lançamentos vencidos</AlertDialogTitle>
            <AlertDialogDescription>
              Informe o juros pago e o novo valor (com juros) para registrar o pagamento em atraso.
              Deixe em branco caso não se aplique.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                Juros pago
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={paidInterest}
                onChange={(e) => setPaidInterest(e.target.value)}
                onPaste={(e) => handlePasteBRL(e, setPaidInterest)}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                Novo valor pago
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                onPaste={(e) => handlePasteBRL(e, setPaidAmount)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setInterestDialogOpen(false);
                executeStatusChange("inserido", {
                  paidInterest: paidInterest ? parseFloat(paidInterest) : undefined,
                  paidAmount: paidAmount ? parseFloat(paidAmount) : undefined,
                });
              }}
            >
              Confirmar
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
