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
import { useAllHotels } from "@/hooks/useHotelAssets";
import {
  useApEntries, useLatestApUpload, useTodayBankBalance, useUpsertBankBalance,
  useSetEntryApproval, uploadApReport, type ApEntry, type FinancialSystem,
  useApDocuments, uploadApDocuments, useLinkDocumentToEntry, useDeleteDocument,
  getDocumentSignedUrl, notifyGgPendencies, type ApDocument,
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
type StatusFilter = "all" | "pending" | "approved" | "issues";

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
  const canApprove = canManage || hasRole("gg");

  const { data: hotels = [] } = useAllHotels();
  const [hotelId, setHotelId] = useState<string | null>(null);
  const hotel = useMemo(() => hotels.find((h) => h.id === hotelId) ?? null, [hotels, hotelId]);
  const sourceSystem = (hotel as any)?.financial_system as FinancialSystem | null;

  const { data: lastUpload } = useLatestApUpload(hotelId);
  const { data: entries = [], isLoading: entriesLoading } = useApEntries(hotelId);
  const { data: balance } = useTodayBankBalance(hotelId);
  const { data: documents = [] } = useApDocuments(hotelId);
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
  const [notifySelected, setNotifySelected] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState(false);

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
      if (status === "issues") {
        const overdue = e.omie_situation?.toLowerCase().includes("atras");
        const noApproval = e.gg_approval !== "approved";
        const noDoc = !e.primary_document_id;
        if (!overdue && !noApproval && !noDoc) return false;
      }
      if (category !== "all" && e.category !== category) return false;
      if (hideTrivial && Number(e.amount || 0) < 1) return false;
      return true;
    });
  }, [entries, period, status, category, hideTrivial]);

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

  const issueCounts = useMemo(() => {
    let notApproved = 0, noDoc = 0, overdue = 0, divergent = 0;
    entries.forEach((e) => {
      if (e.gg_approval !== "approved") notApproved++;
      if (!e.primary_document_id) noDoc++;
      if (e.omie_situation?.toLowerCase().includes("atras")) overdue++;
      const doc = docsByEntry.get(e.id);
      if (doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01) divergent++;
    });
    return { notApproved, noDoc, overdue, divergent };
  }, [entries, docsByEntry]);

  const issueEntries = useMemo(
    () => entries.filter((e) => {
      const overdue = e.omie_situation?.toLowerCase().includes("atras");
      const noApproval = e.gg_approval !== "approved";
      const noDoc = !e.primary_document_id;
      const doc = docsByEntry.get(e.id);
      const divergent = doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(e.amount)) > 0.01;
      return overdue || noApproval || noDoc || divergent;
    }),
    [entries, docsByEntry],
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
    setNotifySelected(new Set(issueEntries.map((e) => e.id)));
    setNotifyOpen(true);
  }

  async function sendNotify() {
    if (!hotelId || notifySelected.size === 0) return;
    setNotifying(true);
    try {
      const r = await notifyGgPendencies({ hotelId, entryIds: Array.from(notifySelected) });
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
      <Card className="p-5 shadow-soft">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Hotel
            </label>
            <Select value={hotelId ?? ""} onValueChange={(v) => setHotelId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um hotel para começar…" />
              </SelectTrigger>
              <SelectContent>
                {hotels.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" />
                      {h.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hotel && (
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
          )}
        </div>
        {hotel && !sourceSystem && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Configure o sistema financeiro deste hotel em <strong>Configurações → Hotéis</strong> antes de importar.
          </p>
        )}
      </Card>

      {!hotelId && (
        <Card className="p-12 text-center text-muted-foreground shadow-soft">
          <Wallet className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Selecione um hotel para visualizar os lançamentos.</p>
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
            </Card>
            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Problemas identificados</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <UrgencyCell label="Sem aprovação GG" count={issueCounts.notApproved} tone="warning" />
                <UrgencyCell label="Sem documento" count={issueCounts.noDoc} tone="info" />
                <UrgencyCell label="Atrasados" count={issueCounts.overdue} tone="danger" />
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
                  disabled={!canManage || uploadingDocs}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={!canManage || uploadingDocs}
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
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="tomorrow">Amanhã</SelectItem>
                  <SelectItem value="this_week">Essa semana</SelectItem>
                  <SelectItem value="next_week">Semana que vem</SelectItem>
                  <SelectItem value="next_month">Próximo mês</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="approved">Aprovados</SelectItem>
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
                    <TableHead>Aprovação GG</TableHead>
                    <TableHead>Doc</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">Nenhum lançamento encontrado.</TableCell></TableRow>
                  ) : filtered.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      doc={docsByEntry.get(e.id) ?? null}
                      sourceSystem={sourceSystem}
                      canApprove={canApprove}
                      canManage={canManage}
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
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
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
            Selecione os lançamentos a incluir no e-mail. {issueEntries.length} pendência(s) detectada(s).
          </p>
          <div className="max-h-[400px] overflow-y-auto border rounded-md divide-y">
            {issueEntries.map((e) => (
              <label key={e.id} className="flex items-start gap-3 p-2 hover:bg-muted/50 cursor-pointer text-sm">
                <Checkbox
                  checked={notifySelected.has(e.id)}
                  onCheckedChange={(c) => {
                    setNotifySelected((prev) => {
                      const next = new Set(prev);
                      if (c) next.add(e.id); else next.delete(e.id);
                      return next;
                    });
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{e.supplier}</p>
                  <p className="text-xs text-muted-foreground">
                    Venc. {fmtDate(e.due_date)} · {fmtBRL(Number(e.amount))} · Doc {e.document_number ?? "—"}
                  </p>
                </div>
              </label>
            ))}
            {issueEntries.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">Sem pendências.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotifyOpen(false)}>Cancelar</Button>
            <Button onClick={sendNotify} disabled={notifying || notifySelected.size === 0} className="gap-2">
              {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Enviar ({notifySelected.size})
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

function UrgencyCell({ label, count, tone }: { label: string; count: number; tone: "danger" | "warning" | "amber" | "info" | "muted" }) {
  const colors: Record<string, string> = {
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    warning: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
    amber: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
    info: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
    muted: "bg-muted text-muted-foreground border-border",
  };
  return (
    <div className={`rounded-md border p-3 text-center ${colors[tone]}`}>
      <p className="text-2xl font-bold leading-none">{count}</p>
      <p className="text-[10px] uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function EntryRow({
  entry, doc, sourceSystem, canApprove, canManage, onLink, onApprove,
}: {
  entry: ApEntry;
  doc: ApDocument | null;
  sourceSystem: FinancialSystem | null;
  canApprove: boolean;
  canManage: boolean;
  onLink: () => void;
  onApprove: (a: "approved" | "rejected" | "pending") => void;
}) {
  const overdue = entry.omie_situation?.toLowerCase().includes("atras");
  const divergent = doc?.nf_amount != null && Math.abs(Number(doc.nf_amount) - Number(entry.amount)) > 0.01;
  return (
    <TableRow className={overdue ? "bg-destructive/5" : ""}>
      <TableCell className="font-medium">{entry.supplier}</TableCell>
      {sourceSystem === "omie" && <TableCell className="text-xs text-muted-foreground">{entry.cnpj ?? "—"}</TableCell>}
      <TableCell className="text-xs">{entry.document_number ?? "—"}</TableCell>
      <TableCell className="text-xs">{fmtDate(entry.due_date)}</TableCell>
      <TableCell className="text-right font-mono text-sm">
        <div>{fmtBRL(Number(entry.amount))}</div>
        {divergent && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">
            NF: {fmtBRL(Number(doc!.nf_amount))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{entry.payment_method ?? entry.category ?? "—"}</TableCell>
      <TableCell>
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
      </TableCell>
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