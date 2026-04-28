import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import {
  useApEntries, useLatestApUpload, useTodayBankBalance, useUpsertBankBalance,
  useSetEntryApproval, uploadApReport, type ApEntry, type FinancialSystem,
  useApDocuments, uploadApDocuments, useLinkDocumentToEntry, useDeleteDocument,
  getDocumentSignedUrl, notifyGgPendencies, validateApDocument, type ApDocument,
} from "@/hooks/useAccountsPayable";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  Wallet, FileSpreadsheet, Building2, Paperclip, Link2, Mail, Trash2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

type Period = "today" | "tomorrow" | "this_week" | "next_week" | "next_month" | "overdue" | "all";
type StatusFilter = "all" | "pending" | "approved" | "issues" | "no_doc";

function isWithinPeriod(due: string | null, period: Period): boolean {
  if (period === "all") return true;
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const diffDays = Math.floor((d.getTime() - today.getTime()) / 86400000);
  switch (period) {
    case "overdue": return diffDays < 0;
    case "today": return diffDays === 0;
    case "tomorrow": return diffDays === 1;
    case "this_week": {
      const dow = today.getDay(); // 0..6
      const endOfWeek = 6 - dow; // dias até sábado
      return diffDays >= 0 && diffDays <= endOfWeek;
    }
    case "next_week": {
      const dow = today.getDay();
      const startNext = 7 - dow;
      const endNext = startNext + 6;
      return diffDays >= startNext && diffDays <= endNext;
    }
    case "next_month": {
      const nextMonth = (today.getMonth() + 1) % 12;
      return d.getMonth() === nextMonth && d.getFullYear() >= today.getFullYear();
    }
  }
}

export default function ContasPagarPage() {
  const { user, hasRole, isMaster } = useAuth();
  const canManage = isMaster || hasRole("financeiro");
  const isGg = hasRole("gg");
  const canApproveBase = canManage || isGg;
  const canUploadDocs = canManage || isGg; // GG agora pode enviar/vincular documentos

  const { data: hotels = [] } = useAllHotels();
  // Filtro global do header (Hotel) é a única fonte de verdade.
  const { hotelId } = useFilters();
  const hotel = useMemo(() => hotels.find((h) => h.id === hotelId) ?? null, [hotels, hotelId]);
  const sourceSystem = (hotel as any)?.financial_system as FinancialSystem | null;
  const isOmie = sourceSystem === "omie";
  // Hotéis OMIE não têm aprovação GG no Falcon — correção é feita direto no OMIE
  const showApproval = !isOmie;
  const canApprove = canApproveBase && showApproval;

  const { data: lastUpload } = useLatestApUpload(hotelId);
  const { data: allEntriesRaw = [], isLoading: entriesLoading } = useApEntries(hotelId);
  const { data: balance } = useTodayBankBalance(hotelId);
  const { data: documents = [] } = useApDocuments(hotelId);
  // Separa entries em ATIVOS (do relatório atual) + ARQUIVADOS (sumiram do último upload).
  // Distribuição de Lucros entra numa lista própria (mas continua "ativa").
  const allEntries = allEntriesRaw;
  const activeEntries = useMemo(() => allEntries.filter((e) => !e.archived_at), [allEntries]);
  const archivedEntries = useMemo(() => allEntries.filter((e) => !!e.archived_at), [allEntries]);
  const distributionEntries = useMemo(() => activeEntries.filter((e) => e.is_distribution), [activeEntries]);
  const entries = useMemo(() => activeEntries.filter((e) => !e.is_distribution), [activeEntries]);

  const upsertBalance = useUpsertBankBalance();
  const setApproval = useSetEntryApproval();
  const linkDoc = useLinkDocumentToEntry();
  const deleteDoc = useDeleteDocument();

  const [balanceInput, setBalanceInput] = useState<string>("");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [hideTrivial, setHideTrivial] = useState<boolean>(true);
  const [groupNd, setGroupNd] = useState<boolean>(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docsRef = useRef<HTMLInputElement | null>(null);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [linkEntry, setLinkEntry] = useState<ApEntry | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyCats, setNotifyCats] = useState({
    notApproved: true,
    noDoc: true,
    overdue: true,
    divergent: true,
  });
  const [notifyHideTrivial, setNotifyHideTrivial] = useState(true);
  const [notifyHideNd, setNotifyHideNd] = useState(false);
  const [notifyDueFrom, setNotifyDueFrom] = useState<string>("");
  const [notifyDueTo, setNotifyDueTo] = useState<string>("");

  const docsByEntry = useMemo(() => {
    const map = new Map<string, ApDocument>();
    documents.forEach((d) => { if (d.entry_id) map.set(d.entry_id, d); });
    return map;
  }, [documents]);

  const unlinkedDocs = useMemo(() => documents.filter((d) => !d.entry_id), [documents]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => e.category && set.add(e.category));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
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
      if (hideTrivial && Number(e.amount || 0) < 1) return false;
      return true;
    });
  }, [entries, period, status, category, hideTrivial, showApproval]);

  // Agrupa lançamentos N/D (sem nº doc) do mesmo fornecedor + mesma data em uma única linha
  type DisplayRow =
    | { kind: "single"; entry: ApEntry }
    | { kind: "group"; supplier: string; due: string | null; entries: ApEntry[]; amount: number };
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!groupNd) return filtered.map((e) => ({ kind: "single" as const, entry: e }));
    const groups = new Map<string, ApEntry[]>();
    const singles: ApEntry[] = [];
    for (const e of filtered) {
      const isNd = !e.document_number || e.document_number.trim() === "" || e.document_number.toUpperCase() === "N/D";
      if (isNd) {
        const key = `${e.supplier}|${e.due_date ?? ""}`;
        const arr = groups.get(key) ?? [];
        arr.push(e);
        groups.set(key, arr);
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
          amount: arr.reduce((s, x) => s + Number(x.amount || 0), 0),
        });
      }
    }
    // ordena por vencimento asc
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

  const totalToPayToday = useMemo(
    () => entries.filter((e) => isWithinPeriod(e.due_date, "today")).reduce((s, e) => s + Number(e.amount || 0), 0),
    [entries],
  );
  const balanceAmount = balance ? Number(balance.amount) : null;
  const balanceDiff = balanceAmount !== null ? balanceAmount - totalToPayToday : null;

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

  // Total a pagar de Distribuição de Lucros (independente de período)
  const distributionTotal = useMemo(
    () => distributionEntries.reduce((s, e) => s + Number(e.amount || 0), 0),
    [distributionEntries],
  );

  const issueCounts = useMemo(() => {
    let notApproved = 0, noDoc = 0, overdue = 0, divergent = 0;
    entries.forEach((e) => {
      if (showApproval && e.gg_approval !== "approved") notApproved++;
      if (!e.primary_document_id) noDoc++;
      if (e.omie_situation?.toLowerCase().includes("atras")) overdue++;
      const doc = docsByEntry.get(e.id);
      const isDivergent =
        doc?.validation_status === "divergence" ||
        (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01);
      if (isDivergent) divergent++;
    });
    return { notApproved, noDoc, overdue, divergent };
  }, [entries, docsByEntry, showApproval]);

  const issueEntries = useMemo(
    () => entries.filter((e) => {
      const overdue = e.omie_situation?.toLowerCase().includes("atras");
      const noApproval = showApproval && e.gg_approval !== "approved";
      const noDoc = !e.primary_document_id;
      const doc = docsByEntry.get(e.id);
      const divergent =
        doc?.validation_status === "divergence" ||
        (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01);
      return overdue || noApproval || noDoc || divergent;
    }),
    [entries, docsByEntry, showApproval],
  );

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !hotelId || !sourceSystem) return;
    setUploading(true);
    try {
      const r = await uploadApReport({ hotelId, sourceSystem, file: f });
      toast.success(`Importado: ${r.entries} lançamentos${r.documents_extracted ? `, ${r.documents_extracted} documentos` : ""}`);
      // refetch
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

  function openNotify() {
    setNotifyCats({ notApproved: true, noDoc: true, overdue: true, divergent: true });
    setNotifyHideTrivial(true);
    setNotifyHideNd(false);
    setNotifyDueFrom("");
    setNotifyDueTo("");
    setNotifyOpen(true);
  }

  // Categoria por entry (independentes — uma entry pode ter várias)
  function entryFlags(e: ApEntry) {
    const overdue = !!e.omie_situation?.toLowerCase().includes("atras");
    const noApproval = showApproval && e.gg_approval !== "approved";
    const noDoc = !e.primary_document_id;
    const doc = docsByEntry.get(e.id);
    const divergent =
      doc?.validation_status === "divergence" ||
      (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01);
    return { overdue, noApproval, noDoc, divergent };
  }

  const notifyEntries = useMemo(() => {
    return issueEntries.filter((e) => {
      const f = entryFlags(e);
      const matches =
        (notifyCats.notApproved && f.noApproval) ||
        (notifyCats.noDoc && f.noDoc) ||
        (notifyCats.overdue && f.overdue) ||
        (notifyCats.divergent && f.divergent);
      if (!matches) return false;
      if (notifyHideTrivial && Number(e.amount || 0) < 1) return false;
      if (notifyHideNd) {
        const isNd = !e.document_number || e.document_number.trim() === "" || e.document_number.toUpperCase() === "N/D";
        if (isNd) return false;
      }
      return true;
    });
  }, [issueEntries, notifyCats, notifyHideTrivial, notifyHideNd, docsByEntry]);

  async function sendNotify() {
    if (!hotelId || notifyEntries.length === 0) return;
    setNotifying(true);
    try {
      const r = await notifyGgPendencies({
        hotelId,
        entryIds: notifyEntries.map((e) => e.id),
        dueFrom: notifyDueFrom || null,
        dueTo: notifyDueTo || null,
      });
      if (r.recipients === 0) {
        toast.warning("Nenhum GG cadastrado para este hotel.");
      } else {
        toast.success(`Notificação enfileirada para ${r.recipients} GG(s).`);
      }
      setNotifyOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao notificar");
    } finally {
      setNotifying(false);
    }
  }

  const acceptedExt = sourceSystem === "totvs" ? ".xls" : ".xlsx,.zip";

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Gestão · Financeiro</p>
        <h1 className="text-2xl font-semibold">Contas a Pagar</h1>
        <p className="text-sm text-muted-foreground">
          Importe os relatórios de TOTVS ou OMIE e acompanhe os lançamentos do hotel.
        </p>
      </div>

      {/* Seletor de hotel */}
      {hotel && (
        <Card className="p-4 shadow-soft flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">{hotel.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sistema financeiro:</span>
            {sourceSystem ? (
              <Badge variant="outline" className="uppercase">{sourceSystem}</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Não configurado
              </Badge>
            )}
          </div>
          {!sourceSystem && (
            <p className="text-xs text-amber-600 flex items-center gap-1 w-full">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configure o sistema financeiro deste hotel em <strong>Configurações → Hotéis</strong> antes de importar.
            </p>
          )}
        </Card>
      )}

      {!hotelId && (
        <Card className="p-12 text-center text-muted-foreground shadow-soft">
          <Wallet className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Selecione um hotel no filtro do topo para visualizar os lançamentos.</p>
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
                          hotelId, amount: parseFloat(balanceInput), userId: user.id,
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
            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Urgência de pagamento</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <UrgencyCell label="Vencidos" count={entries.filter((e) => isWithinPeriod(e.due_date, "overdue")).length} tone="danger" active={period === "overdue"} onClick={() => setPeriod(period === "overdue" ? "all" : "overdue")} />
                <UrgencyCell label="Hoje" count={urgencyCounts.today} tone="danger" active={period === "today"} onClick={() => setPeriod(period === "today" ? "all" : "today")} />
                <UrgencyCell label="Amanhã" count={urgencyCounts.tomorrow} tone="warning" active={period === "tomorrow"} onClick={() => setPeriod(period === "tomorrow" ? "all" : "tomorrow")} />
                <UrgencyCell label="Essa semana" count={urgencyCounts.thisWeek} tone="amber" active={period === "this_week"} onClick={() => setPeriod(period === "this_week" ? "all" : "this_week")} />
                <UrgencyCell label="Sem. que vem" count={urgencyCounts.nextWeek} tone="info" active={period === "next_week"} onClick={() => setPeriod(period === "next_week" ? "all" : "next_week")} />
                <UrgencyCell label="Próx. mês" count={urgencyCounts.nextMonth} tone="muted" active={period === "next_month"} onClick={() => setPeriod(period === "next_month" ? "all" : "next_month")} />
              </div>
              {distributionEntries.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-accent font-semibold">Distribuição de Lucros</p>
                    <p className="text-xs text-muted-foreground">{distributionEntries.length} lançamento(s) — listagem separada abaixo</p>
                  </div>
                  <p className="text-base font-bold">{fmtBRL(distributionTotal)}</p>
                </div>
              )}
            </Card>
            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Problemas identificados</h3>
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
                onClick={openNotify}
              >
                <Mail className="h-4 w-4" /> Notificar GG ({issueEntries.length})
              </Button>
            </Card>
          </div>

          {/* Importação + filtros */}
          <Card className="p-5 shadow-soft space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider">Lançamentos</h3>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "lançamento" : "lançamentos"} · total {entries.length}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {lastUpload && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Último: {fmtDateTime(lastUpload.uploaded_at)}
                  </span>
                )}
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
                  {uploadingDocs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  Importar Documentos
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2"
                  disabled={!canManage || !sourceSystem || uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
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
              ) : <div />}
            </div>

            {/* Toggles auxiliares */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={hideTrivial}
                  onCheckedChange={(c) => setHideTrivial(!!c)}
                />
                Ocultar lançamentos abaixo de R$ 1,00
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={groupNd}
                  onCheckedChange={(c) => setGroupNd(!!c)}
                />
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
                    <TableRow><TableCell colSpan={showApproval ? 9 : 8} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                  ) : displayRows.length === 0 ? (
                    <TableRow><TableCell colSpan={showApproval ? 9 : 8} className="text-center text-sm text-muted-foreground py-8">Nenhum lançamento encontrado.</TableCell></TableRow>
                  ) : displayRows.map((row, idx) => {
                    if (row.kind === "group") {
                      const colSpan = (sourceSystem === "omie" ? 9 : 8) - (showApproval ? 0 : 1);
                      return (
                        <TableRow key={`g-${idx}`} className="bg-muted/30">
                          <TableCell className="font-medium">
                            {row.supplier} <span className="text-muted-foreground font-normal">({row.entries.length})</span>
                          </TableCell>
                          {sourceSystem === "omie" && <TableCell className="text-xs text-muted-foreground">—</TableCell>}
                          <TableCell className="text-xs text-muted-foreground italic">N/D agrupado</TableCell>
                          <TableCell className="text-xs">{fmtDate(row.due)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtBRL(row.amount)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground" colSpan={colSpan - (sourceSystem === "omie" ? 5 : 4)}>
                            {row.entries.length} lançamento(s) sem nº de documento
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const e = row.entry;
                    return (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        doc={docsByEntry.get(e.id) ?? null}
                        sourceSystem={sourceSystem}
                        canApprove={canApprove}
                        canManage={canManage}
                        showApproval={showApproval}
                        onLink={() => setLinkEntry(e)}
                        onApprove={async (approval) => {
                          if (!user) return;
                          try {
                            await setApproval.mutateAsync({
                              entryId: e.id, hotelId, approval, userId: user.id,
                            });
                            toast.success(approval === "approved" ? "Aprovado" : approval === "rejected" ? "Recusado" : "Pendente");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
                          }
                        }}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {/* Tabela separada — Distribuição de Lucros */}
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
                  <EntryRow
                    key={e.id}
                    entry={e}
                    doc={docsByEntry.get(e.id) ?? null}
                    sourceSystem={sourceSystem}
                    canApprove={canApprove}
                    canManage={canManage}
                    showApproval={showApproval}
                    compact
                    onLink={() => setLinkEntry(e)}
                    onApprove={async (approval) => {
                      if (!user) return;
                      try {
                        await setApproval.mutateAsync({ entryId: e.id, hotelId, approval, userId: user.id });
                        toast.success(approval === "approved" ? "Aprovado" : approval === "rejected" ? "Recusado" : "Pendente");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
                      }
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Modal de vínculo */}
      <LinkDocDialog
        open={!!linkEntry}
        onClose={() => setLinkEntry(null)}
        entry={linkEntry}
        documents={documents}
        currentDoc={linkEntry ? (docsByEntry.get(linkEntry.id) ?? null) : null}
        unlinkedDocs={unlinkedDocs}
        onLink={async (docId, nfAmount) => {
          if (!linkEntry || !hotelId) return;
          try {
            await linkDoc.mutateAsync({
              hotelId, entryId: linkEntry.id, documentId: docId, nfAmount,
            });
            toast.success(docId ? "Documento vinculado" : "Vínculo removido");
            // Trigger validação IA em background (não bloqueia o fluxo)
            if (docId) {
              validateApDocument({ documentId: docId, entryId: linkEntry.id })
                .then((r) => {
                  if (r.validation_status === "divergence") toast.warning("Divergência detectada pela IA");
                  else if (r.validation_status === "ok") toast.success("Documento validado pela IA");
                })
                .catch(() => { /* silencioso */ });
            }
            setLinkEntry(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao vincular");
          }
        }}
        onDelete={async (d) => {
          if (!hotelId) return;
          if (!confirm(`Excluir documento "${d.file_name}"?`)) return;
          try {
            await deleteDoc.mutateAsync({ hotelId, documentId: d.id, filePath: d.file_path });
            toast.success("Documento excluído");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao excluir");
          }
        }}
      />

      {/* Modal Notificar GG */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notificar GG sobre pendências</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Escolha quais categorias de pendência devem ser incluídas no e-mail ao GG.
          </p>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Categorias</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
                <Checkbox
                  checked={notifyCats.notApproved}
                  onCheckedChange={(c) => setNotifyCats((s) => ({ ...s, notApproved: !!c }))}
                />
                <span className="flex-1 text-sm">Sem aprovação GG</span>
                <Badge variant="outline">{issueCounts.notApproved}</Badge>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
                <Checkbox
                  checked={notifyCats.noDoc}
                  onCheckedChange={(c) => setNotifyCats((s) => ({ ...s, noDoc: !!c }))}
                />
                <span className="flex-1 text-sm">Sem documento</span>
                <Badge variant="outline">{issueCounts.noDoc}</Badge>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
                <Checkbox
                  checked={notifyCats.overdue}
                  onCheckedChange={(c) => setNotifyCats((s) => ({ ...s, overdue: !!c }))}
                />
                <span className="flex-1 text-sm">Atrasados</span>
                <Badge variant="outline">{issueCounts.overdue}</Badge>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/40">
                <Checkbox
                  checked={notifyCats.divergent}
                  onCheckedChange={(c) => setNotifyCats((s) => ({ ...s, divergent: !!c }))}
                />
                <span className="flex-1 text-sm">Divergência de valor</span>
                <Badge variant="outline">{issueCounts.divergent}</Badge>
              </label>
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">Filtros</p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Vencimento de</label>
                  <Input
                    type="date"
                    value={notifyDueFrom}
                    onChange={(e) => setNotifyDueFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Vencimento até</label>
                  <Input
                    type="date"
                    value={notifyDueTo}
                    onChange={(e) => setNotifyDueTo(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={notifyHideTrivial}
                  onCheckedChange={(c) => setNotifyHideTrivial(!!c)}
                />
                Ocultar lançamentos abaixo de R$ 1,00
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={notifyHideNd}
                  onCheckedChange={(c) => setNotifyHideNd(!!c)}
                />
                Ocultar lançamentos N/D (sem nº de documento)
              </label>
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-sm">
              Serão notificados <strong>{notifyEntries.length}</strong> lançamento(s)
              {notifyEntries.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}· total {fmtBRL(notifyEntries.reduce((s, e) => s + Number(e.amount || 0), 0))}
                </span>
              )}
              .
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotifyOpen(false)}>Cancelar</Button>
            <Button onClick={sendNotify} disabled={notifying || notifyEntries.length === 0} className="gap-2">
              {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Enviar notificação ({notifyEntries.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function UrgencyCell({
  label, count, tone, active, onClick,
}: {
  label: string;
  count: number;
  tone: "danger" | "warning" | "amber" | "info" | "muted";
  active?: boolean;
  onClick?: () => void;
}) {
  const colors: Record<string, string> = {
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    warning: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
    amber: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
    info: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
    muted: "bg-muted text-muted-foreground border-border",
  };
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-md border px-2 py-2.5 text-center min-h-[72px] flex flex-col items-center justify-center gap-1 transition-all ${colors[tone]} ${onClick ? "hover:shadow-soft hover:scale-[1.02] cursor-pointer" : ""} ${active ? "ring-2 ring-offset-1 ring-current" : ""}`}
    >
      <p className="text-xl font-bold leading-none">{count}</p>
      <p className="text-[9px] uppercase tracking-wide leading-tight break-words w-full">{label}</p>
    </Comp>
  );
}

function EntryRow({
  entry, doc, sourceSystem, canApprove, canManage, showApproval = true, onLink, onApprove, compact,
}: {
  entry: ApEntry;
  doc: ApDocument | null;
  sourceSystem: FinancialSystem | null;
  canApprove: boolean;
  canManage: boolean;
  showApproval?: boolean;
  onLink: () => void;
  onApprove: (a: "approved" | "rejected" | "pending") => void;
  compact?: boolean;
}) {
  const overdue = entry.omie_situation?.toLowerCase().includes("atras");
  const divergent =
    doc?.validation_status === "divergence" ||
    (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(entry.amount)) > 0.01);
  const archived = !!entry.archived_at;
  return (
    <TableRow className={`${overdue ? "bg-destructive/5" : ""} ${archived ? "opacity-60" : ""}`}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span>{entry.supplier}</span>
          {archived && <Badge variant="outline" className="text-[10px]">Arquivado</Badge>}
          {divergent && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> Divergência
            </Badge>
          )}
        </div>
      </TableCell>
      {!compact && sourceSystem === "omie" && <TableCell className="text-xs text-muted-foreground">{entry.cnpj ?? "—"}</TableCell>}
      {!compact && <TableCell className="text-xs">{entry.document_number ?? "—"}</TableCell>}
      <TableCell className="text-xs">{fmtDate(entry.due_date)}</TableCell>
      <TableCell className="text-right font-mono text-sm">
        <div>{fmtBRL(Number(entry.amount))}</div>
        {doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(entry.amount)) > 0.01 && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">
            NF: {fmtBRL(Number(doc!.nf_amount))}
          </div>
        )}
      </TableCell>
      {!compact && <TableCell className="text-xs text-muted-foreground">{entry.payment_method ?? entry.category ?? "—"}</TableCell>}
      {showApproval && <TableCell>
        {entry.gg_approval === "approved" ? (
          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Aprovado
          </Badge>
        ) : entry.gg_approval === "rejected" ? (
          <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
            <XCircle className="h-3 w-3" /> Recusado
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
            <Clock className="h-3 w-3" /> Pendente
          </Badge>
        )}
      </TableCell>}
      <TableCell>
        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={onLink}
            title={doc ? doc.file_name : "Vincular documento"}
          >
            {doc ? (
              <>
                <CheckCircle2 className={`h-3.5 w-3.5 ${divergent ? "text-amber-600" : "text-emerald-600"}`} />
                <span className="truncate max-w-[100px]">{doc.file_name}</span>
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                Vincular
              </>
            )}
          </Button>
        ) : doc ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canApprove && entry.gg_approval !== "approved" && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onApprove("approved")}>
            Aprovar
          </Button>
        )}
        {canApprove && entry.gg_approval !== "rejected" && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => onApprove("rejected")}>
            Recusar
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function LinkDocDialog({
  open, onClose, entry, documents, currentDoc, unlinkedDocs, onLink, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  entry: ApEntry | null;
  documents: ApDocument[];
  currentDoc: ApDocument | null;
  unlinkedDocs: ApDocument[];
  onLink: (docId: string | null, nfAmount: number | null) => Promise<void> | void;
  onDelete: (d: ApDocument) => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [nfAmountInput, setNfAmountInput] = useState<string>("");

  // reset on entry change
  const entryId = entry?.id ?? null;
  useMemo(() => {
    setSelectedId(currentDoc?.id ?? "");
    setNfAmountInput(currentDoc?.nf_amount != null ? String(currentDoc.nf_amount) : "");
  }, [entryId, currentDoc?.id]);

  if (!entry) return null;

  const choices = currentDoc ? [currentDoc, ...unlinkedDocs] : unlinkedDocs;

  async function openDoc(d: ApDocument) {
    const url = await getDocumentSignedUrl(d.file_path);
    if (url) window.open(url, "_blank");
    else toast.error("Não foi possível abrir o arquivo");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular documento ao lançamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p className="font-semibold">{entry.supplier}</p>
            <p className="text-xs text-muted-foreground">
              Doc {entry.document_number ?? "—"} · Venc. {fmtDate(entry.due_date)} · {fmtBRL(Number(entry.amount))}
            </p>
          </div>

          {currentDoc?.validation_status && (
            <div className={`rounded-md border p-3 text-xs space-y-1 ${
              currentDoc.validation_status === "ok"
                ? "border-emerald-500/40 bg-emerald-500/5"
                : currentDoc.validation_status === "divergence"
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-border bg-muted/30"
            }`}>
              <div className="flex items-center gap-2 font-semibold">
                {currentDoc.validation_status === "ok" ? (
                  <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Validado pela IA</>
                ) : currentDoc.validation_status === "divergence" ? (
                  <><AlertTriangle className="h-4 w-4 text-amber-600" /> Divergência detectada</>
                ) : (
                  <><Clock className="h-4 w-4" /> Validação: {currentDoc.validation_status}</>
                )}
              </div>
              {currentDoc.doc_type && <p>Tipo: <span className="font-mono">{currentDoc.doc_type}</span></p>}
              {currentDoc.doc_cnpj && <p>CNPJ no documento: <span className="font-mono">{currentDoc.doc_cnpj}</span></p>}
              {currentDoc.nf_amount != null && <p>Valor NF: <span className="font-mono">{fmtBRL(Number(currentDoc.nf_amount))}</span></p>}
              {currentDoc.validation_details?.summary && (
                <p className="text-muted-foreground italic">{String(currentDoc.validation_details.summary)}</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Documento ({choices.length} disponível{choices.length === 1 ? "" : "is"})
            </label>
            {choices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md">
                Nenhum documento disponível. Use "Importar Documentos" no topo da página.
              </p>
            ) : (
              <div className="border rounded-md max-h-[260px] overflow-y-auto divide-y">
                {choices.map((d) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50 ${
                      selectedId === d.id ? "bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <input
                      type="radio"
                      checked={selectedId === d.id}
                      onChange={() => setSelectedId(d.id)}
                    />
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{d.file_name}</span>
                    <Button
                      size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={(e) => { e.stopPropagation(); openDoc(d); }}
                      title="Abrir"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(d); }}
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Valor da NF (opcional — para detectar divergência)
            </label>
            <Input
              type="number"
              step="0.01"
              placeholder={String(entry.amount)}
              value={nfAmountInput}
              onChange={(e) => setNfAmountInput(e.target.value)}
            />
            {nfAmountInput && Math.abs(parseFloat(nfAmountInput) - Number(entry.amount)) > 0.01 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Diferença de {fmtBRL(parseFloat(nfAmountInput) - Number(entry.amount))} em relação ao lançamento.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          {currentDoc && (
            <Button variant="ghost" onClick={() => onLink(null, null)} className="mr-auto">
              Remover vínculo
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!selectedId}
            onClick={() => onLink(selectedId, nfAmountInput ? parseFloat(nfAmountInput) : null)}
          >
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}