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
import { AlertTriangle, Building2, FileSpreadsheet, Loader2, Mail, Paperclip, Upload, Wallet } from "lucide-react";
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
import { useAllHotels } from "@/hooks/useHotelAssets";
import {
  notifyGgPendencies,
  uploadApDocuments,
  uploadApReport,
  useApDocuments,
  useApEntries,
  useDeleteDocument,
  useLinkDocumentToEntry,
  useLatestApUpload,
  useSetEntryApproval,
  useTodayBankBalance,
  useUpsertBankBalance,
  validateApDocument,
  type ApEntry,
  type FinancialSystem,
} from "@/hooks/useAccountsPayable";
import { useApPageDerived } from "@/hooks/useApPageDerived";
import type { Period, StatusFilter } from "@/lib/apPeriodFilter";
import { isWithinPeriod } from "@/lib/apPeriodFilter";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";

import { ApEntryRow } from "@/components/accounts-payable/ApEntryRow";
import { Stat, UrgencyCell } from "@/components/accounts-payable/ApStatCards";
import { LinkDocDialog } from "@/components/accounts-payable/LinkDocDialog";
import { NotifyGgDialog } from "@/components/accounts-payable/NotifyGgDialog";

import { useMemo } from "react";

export default function ContasPagarPage() {
  const { user, hasRole, isMaster } = useAuth();
  const canManage = isMaster || hasRole("financeiro");
  const isGg = hasRole("gg");
  const canApproveBase = canManage || isGg;
  const canUploadDocs = canManage || isGg;

  const { data: hotels = [] } = useAllHotels();
  const { hotelId } = useFilters();
  const hotel = useMemo(() => hotels.find((h) => h.id === hotelId) ?? null, [hotels, hotelId]);
  const sourceSystem = (hotel as any)?.financial_system as FinancialSystem | null;
  const isOmie = sourceSystem === "omie";
  // Hotéis OMIE não têm aprovação GG no Falcon — correção é feita direto no OMIE.
  const showApproval = !isOmie;
  const canApprove = canApproveBase && showApproval;

  // ── Dados remotos ──────────────────────────────────────────────────────
  const { data: lastUpload } = useLatestApUpload(hotelId);
  const { data: allEntriesRaw = [], isLoading: entriesLoading } = useApEntries(hotelId);
  const { data: balance } = useTodayBankBalance(hotelId);
  const { data: documents = [] } = useApDocuments(hotelId);

  // ── Mutations ──────────────────────────────────────────────────────────
  const upsertBalance = useUpsertBankBalance();
  const setApproval = useSetEntryApproval();
  const linkDocMutation = useLinkDocumentToEntry();
  const deleteDocMutation = useDeleteDocument();

  // ── Estado local ───────────────────────────────────────────────────────
  const [balanceInput, setBalanceInput] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [hideTrivial, setHideTrivial] = useState(true);
  const [groupNd, setGroupNd] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [linkEntry, setLinkEntry] = useState<ApEntry | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<HTMLInputElement>(null);

  // ── Derivações ─────────────────────────────────────────────────────────
  const derived = useApPageDerived({
    allEntriesRaw,
    documents,
    balance,
    sourceSystem,
    period,
    status,
    category,
    hideTrivial,
    groupNd,
    showApproval,
  });

  const {
    entries,
    distributionEntries,
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

  async function handleDocs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !hotelId || !user) return;
    setUploadingDocs(true);
    try {
      const n = await uploadApDocuments({ hotelId, files, userId: user.id });
      toast.success(`${n} documento(s) enviado(s). Vincule-os aos lançamentos.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar documentos");
    } finally {
      setUploadingDocs(false);
      if (docsRef.current) docsRef.current.value = "";
    }
  }

  async function handleApprove(entryId: string, approval: "approved" | "rejected" | "pending") {
    if (!user || !hotelId) return;
    try {
      await setApproval.mutateAsync({ entryId, hotelId, approval, userId: user.id });
      toast.success(
        approval === "approved" ? "Aprovado" : approval === "rejected" ? "Recusado" : "Pendente",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  }

  async function handleLink(docId: string | null, nfAmount: number | null) {
    if (!linkEntry || !hotelId) return;
    try {
      await linkDocMutation.mutateAsync({
        hotelId,
        entryId: linkEntry.id,
        documentId: docId,
        nfAmount,
      });
      toast.success(docId ? "Documento vinculado" : "Vínculo removido");
      // Validação IA em background — não bloqueia o fluxo
      if (docId) {
        validateApDocument({ documentId: docId, entryId: linkEntry.id })
          .then((r) => {
            if (r.validation_status === "divergence")
              toast.warning("Divergência detectada pela IA");
            else if (r.validation_status === "ok")
              toast.success("Documento validado pela IA");
          })
          .catch(() => {});
      }
      setLinkEntry(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao vincular");
    }
  }

  async function handleDeleteDoc(d: Parameters<typeof deleteDocMutation.mutateAsync>[0]) {
    if (!hotelId) return;
    if (!confirm(`Excluir documento "${d.filePath}"?`)) return;
    try {
      await deleteDocMutation.mutateAsync(d);
      toast.success("Documento excluído");
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {showApproval && (
                  <UrgencyCell
                    label="Sem aprovação GG"
                    count={issueCounts.notApproved}
                    tone="warning"
                    active={status === "issues"}
                    onClick={() => setStatus(status === "issues" ? "all" : "issues")}
                  />
                )}
                <UrgencyCell
                  label="Sem documento"
                  count={issueCounts.noDoc}
                  tone="info"
                  active={status === "no_doc"}
                  onClick={() => setStatus(status === "no_doc" ? "all" : "no_doc")}
                />
                <UrgencyCell
                  label="Atrasados"
                  count={issueCounts.overdue}
                  tone="danger"
                  active={period === "overdue"}
                  onClick={() => setPeriod(period === "overdue" ? "all" : "overdue")}
                />
                <UrgencyCell label="Divergência valor" count={issueCounts.divergent} tone="amber" />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    {sourceSystem === "omie" && <TableHead>CNPJ</TableHead>}
                    <TableHead>Nº Doc</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Forma</TableHead>
                    {showApproval && <TableHead>Aprovação GG</TableHead>}
                    <TableHead>Doc</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={showApproval ? 9 : 8}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Carregando…
                      </TableCell>
                    </TableRow>
                  ) : displayRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={showApproval ? 9 : 8}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Nenhum lançamento encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayRows.map((row, idx) => {
                      if (row.kind === "group") {
                        const colSpan =
                          (sourceSystem === "omie" ? 9 : 8) - (showApproval ? 0 : 1);
                        return (
                          <TableRow key={`g-${idx}`} className="bg-muted/30">
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
                          onLink={() => setLinkEntry(e)}
                          onApprove={(approval) => handleApprove(e.id, approval)}
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
        documents={[...docsByEntry.values(), ...unlinkedDocs]}
        currentDoc={linkEntry ? (docsByEntry.get(linkEntry.id) ?? null) : null}
        unlinkedDocs={unlinkedDocs}
        onLink={handleLink}
        onDelete={(d) =>
          handleDeleteDoc({ hotelId: hotelId!, documentId: d.id, filePath: d.file_path })
        }
      />

      {/* Modal de notificação ao GG */}
      {hotelId && (
        <NotifyGgDialog
          open={notifyOpen}
          onClose={() => setNotifyOpen(false)}
          hotelId={hotelId}
          issueEntries={issueEntries}
          issueCounts={issueCounts}
          showApproval={showApproval}
        />
      )}
    </div>
  );
}
