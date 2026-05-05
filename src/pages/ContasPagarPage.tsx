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
import { useRef, useState } from "react";
import { AlertTriangle, Banknote, Building2, CalendarClock, CheckCircle2, FileDown, FileSpreadsheet, Loader2, Mail, Search, Upload, Wallet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useAllHotels, type HotelRow } from "@/hooks/useHotelAssets";
import {
  uploadApReport,
  useApEntries,
  useLatestApUpload,
  useSetEntryPaymentStatus,
  useTodayBankBalance,
  useUpsertBankBalance,
  type ApEntry,
  type ApPaymentStatus,
  type FinancialSystem,
} from "@/hooks/useAccountsPayable";
import { useApPageDerived } from "@/hooks/useApPageDerived";
import type { Period, StatusFilter } from "@/lib/apPeriodFilter";
import { isWithinPeriod } from "@/lib/apPeriodFilter";
import { fmtBRL, fmtDate, fmtDateTime } from "@/lib/formatters";

import { ApEntryRow } from "@/components/accounts-payable/ApEntryRow";
import { Stat, UrgencyCell } from "@/components/accounts-payable/ApStatCards";
import { NotifyGgDialog } from "@/components/accounts-payable/NotifyGgDialog";

import { useMemo } from "react";

export default function ContasPagarPage() {
  const {
    user,
    hasRole,
    isMaster,
    isFinanceiroEquipe,
    isFinanceiroCoordenadora,
  } = useAuth();
  const canManage = isMaster || hasRole("financeiro");
  // Marcações em lote — equipe pode marcar Inserido/Agendado; só coordenadora/master pode Pago.
  const canMarkInsertedAgendado =
    isMaster || isFinanceiroEquipe || isFinanceiroCoordenadora;
  const canMarkPaid = isMaster || isFinanceiroCoordenadora;
  const isGg = hasRole("gg");
  const canApproveBase = canManage || isGg;

  const { data: hotels = [] } = useAllHotels();
  const { hotelId, dateFrom, dateTo } = useFilters();
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
  const { data: balance } = useTodayBankBalance(hotelId);

  // ── Mutations ──────────────────────────────────────────────────────────
  const upsertBalance = useUpsertBankBalance();
  const setPaymentStatus = useSetEntryPaymentStatus();

  // ── Estado local ───────────────────────────────────────────────────────
  const [balanceInput, setBalanceInput] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [hideTrivial, setHideTrivial] = useState(true);
  const [groupNd, setGroupNd] = useState(true);
  const [searchText, setSearchText] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Derivações ─────────────────────────────────────────────────────────
  const derived = useApPageDerived({
    allEntriesRaw,
    documents: [],
    balance,
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

  const balanceAmount = balance ? Number(balance.amount) : null;
  const acceptedExt = sourceSystem === "totvs" ? ".xls" : ".xlsx,.zip";

  // ── Handlers ───────────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !hotelId || !sourceSystem) return;
    setUploading(true);
    try {
      const r = await uploadApReport({ hotelId, sourceSystem, file: f });
      toast.success(
        `Importado: ${r.entries} lançamentos${r.documents_extracted ? `, ${r.documents_extracted} documentos` : ""}`,
      );
      window.dispatchEvent(new CustomEvent("ap:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
    if ((newStatus === "inserido" || newStatus === "agendado") && !canMarkInsertedAgendado) {
      toast.error("Sem permissão para alterar status");
      return;
    }
    try {
      await setPaymentStatus.mutateAsync({ hotelId, entryIds: ids, status: newStatus });
      toast.success(`${ids.length} lançamento(s) marcados como ${labelForStatus(newStatus)}`);
      setSelectedIds(new Set());
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
    return s === "pago" ? "Pago" : s === "inserido" ? "Inserido" : s === "agendado" ? "Agendado" : "Pendente";
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
        <Card className="p-12 text-center text-muted-foreground shadow-soft">
          <Wallet className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            Selecione um hotel no filtro do topo para visualizar os lançamentos.
          </p>
        </Card>
      )}

      {hotelId && (
        <>
          {/* Saldo bancário */}
          <Card className="p-5 shadow-soft">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="md:col-span-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                  Saldo bancário do dia
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={balance ? String(balance.amount) : "0,00"}
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    disabled={!canManage}
                  />
                  <Button
                    size="sm"
                    disabled={!canManage || !balanceInput || upsertBalance.isPending}
                    onClick={async () => {
                      if (!user) return;
                      try {
                        await upsertBalance.mutateAsync({
                          hotelId,
                          amount: parseFloat(balanceInput),
                          userId: user.id,
                        });
                        toast.success("Saldo informado");
                        setBalanceInput("");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Erro ao salvar saldo");
                      }
                    }}
                  >
                    Salvar
                  </Button>
                </div>
                {balance && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Atualizado: {fmtDateTime(balance.updated_at)}
                  </p>
                )}
              </div>
              <Stat label="Saldo informado" value={balanceAmount !== null ? fmtBRL(balanceAmount) : "—"} />
              <Stat label="Total a pagar hoje" value={fmtBRL(totalToPayToday)} />
              <Stat
                label="Diferença"
                value={balanceDiff !== null ? fmtBRL(balanceDiff) : "—"}
                tone={balanceDiff !== null && balanceDiff < 0 ? "danger" : "neutral"}
              />
            </div>
          </Card>

          {/* Painéis de alerta */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

            {/* Problemas */}
            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
                Problemas identificados
              </h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {ISSUE_CATEGORIES
                  .filter((cat) => cat.key !== "sem_aprovacao" || showApproval)
                  .map((cat) => {
                    const filterKey = `issue_${cat.key}` as StatusFilter;
                    return (
                      <UrgencyCell
                        key={cat.key}
                        label={cat.label}
                        count={issueCounts[cat.key]}
                        tone={cat.tone}
                        active={status === filterKey}
                        onClick={() =>
                          setStatus(status === filterKey ? "all" : filterKey)
                        }
                      />
                    );
                  })}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2"
                disabled={!canManage || issueEntries.length === 0}
                onClick={() => setNotifyOpen(true)}
              >
                <Mail className="h-4 w-4" /> Notificar GG ({issueEntries.length})
              </Button>
            </Card>
          </div>

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
                <input
                  ref={docsRef}
                  type="file"
                  multiple
                  accept=".pdf,.ofx,.xml,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleDocs}
                  disabled={!canUploadDocs || uploadingDocs}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={!canUploadDocs || uploadingDocs}
                  onClick={() => docsRef.current?.click()}
                  title="Enviar PDFs/OFX/XML para vincular manualmente"
                >
                  {uploadingDocs ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  Importar Documentos
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={displayRows.length === 0}
                  onClick={() => {
                    const data = displayRows.flatMap((row) => {
                      if (row.kind === "group") return [];
                      const e = row.entry;
                      const d = docsByEntry.get(e.id);
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
                        "Documento Vinculado": d?.file_name ?? "",
                        "Validação IA": d?.validation_status ?? "",
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
                  {showApproval && <SelectItem value="pending">Pendentes</SelectItem>}
                  {showApproval && <SelectItem value="approved">Aprovados</SelectItem>}
                  <SelectItem value="no_doc">Sem documento</SelectItem>
                  <SelectItem value="issues">Com problema</SelectItem>
                  <SelectItem value="payment_pendente">Pendente de inserção</SelectItem>
                  <SelectItem value="payment_inserido">Inserido no banco</SelectItem>
                  <SelectItem value="payment_agendado">Agendado</SelectItem>
                  <SelectItem value="payment_pago">Pago</SelectItem>
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

            {/* Tabela */}
            <div className="border rounded-md overflow-hidden">
              {/* Barra de ações em lote */}
              {(canMarkInsertedAgendado || canMarkPaid) && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b bg-muted/30 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} selecionado(s)`
                      : "Selecione lançamentos para marcar status em lote"}
                  </div>
                  <div className="flex items-center gap-2">
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
                    {sourceSystem === "omie" && <TableHead>CNPJ</TableHead>}
                    <TableHead>Nº Doc</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Forma</TableHead>
                    {showApproval && <TableHead>Aprovação GG</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead>Doc</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={(showApproval ? 9 : 8) + 1 + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0)}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Carregando…
                      </TableCell>
                    </TableRow>
                  ) : displayRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={(showApproval ? 9 : 8) + 1 + ((canMarkInsertedAgendado || canMarkPaid) ? 1 : 0)}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Nenhum lançamento encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayRows.map((row, idx) => {
                      if (row.kind === "group") {
                        const colSpan =
                          (sourceSystem === "omie" ? 9 : 8) - (showApproval ? 0 : 1) + 1 +
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
                          doc={docsByEntry.get(e.id) ?? null}
                          sourceSystem={sourceSystem}
                          canApprove={canApprove}
                          canManage={canManage}
                          showApproval={showApproval}
                          selectable={canMarkInsertedAgendado || canMarkPaid}
                          selected={selectedIds.has(e.id)}
                          onToggleSelected={(v) => toggleSelected(e.id, v)}
                          onLink={() => setLinkEntry(e)}
                          onApprove={(approval) => handleApprove(e.id, approval)}
                          issues={entryIssues(e)}
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
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
                  <TableHead>Fornecedor / Sócio</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Aprovação GG</TableHead>
                  <TableHead>Doc</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributionEntries.map((e) => (
                  <ApEntryRow
                    key={e.id}
                    entry={e}
                    doc={docsByEntry.get(e.id) ?? null}
                    sourceSystem={sourceSystem}
                    canApprove={canApprove}
                    canManage={canManage}
                    showApproval={showApproval}
                    compact
                    onLink={() => setLinkEntry(e)}
                    onApprove={(approval) => handleApprove(e.id, approval)}
                    issues={entryIssues(e)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Modal de vínculo de documento */}
      <LinkDocDialog
        open={!!linkEntry}
        onClose={() => setLinkEntry(null)}
        entry={linkEntry}
        linkedDocs={linkEntry ? (allDocsByEntry.get(linkEntry.id) ?? []) : []}
        primaryDoc={linkEntry ? (docsByEntry.get(linkEntry.id) ?? null) : null}
        unlinkedDocs={unlinkedDocs}
        onAttach={(documentId, nfAmount) =>
          attachDocMutation.mutateAsync({
            hotelId: hotelId!,
            entryId: linkEntry!.id,
            documentId,
            nfAmount,
          })
        }
        onDetach={(d) =>
          detachDocMutation.mutateAsync({
            hotelId: hotelId!,
            entryId: linkEntry!.id,
            documentId: d.id,
          })
        }
        onSetPrimary={(d) =>
          setPrimaryDocMutation.mutateAsync({
            hotelId: hotelId!,
            entryId: linkEntry!.id,
            documentId: d.id,
          })
        }
        onDelete={(d) =>
          handleDeleteDoc({ hotelId: hotelId!, documentId: d.id, filePath: d.file_path })
        }
      />

      <AlertDialog
        open={!!deleteDocConfirm}
        onOpenChange={(open) => { if (!open) setDeleteDocConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDocConfirm?.filePath?.split("/").pop() ?? "Este documento"} será
              removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDeleteDoc}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de notificação ao GG */}
      {hotelId && (
        <NotifyGgDialog
          open={notifyOpen}
          onClose={() => setNotifyOpen(false)}
          hotelId={hotelId}
          issueEntries={issueEntries}
          issueCounts={issueCounts}
          showApproval={showApproval}
          entryIssues={entryIssues}
        />
      )}
    </div>
  );
}
