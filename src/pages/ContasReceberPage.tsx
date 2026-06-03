import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import {
  useToInvoiceEntries,
  useOpenFolioEntries,
  useLatestArUpload,
  useLatestToInvoiceDate,
  useUploadArReport,
  useClientContracts,
  useUpsertContract,
  useDeleteContract,
  useOpenFolioNotes,
  useAllOpenFolioNotes,
  useUpsertOpenFolioNote,
  useSetToInvoiceGgStatus,
  useDeleteArUpload,
  useArUploadsByKind,
  findContractTerm,
  addDays,
  type ToInvoiceEntry,
  type OpenFolioEntry,
  type ClientContract,
} from "@/hooks/useAccountsReceivable";
import { Upload, Loader2, FileSpreadsheet, AlertTriangle, ArrowLeft, Plus, Trash2, MessageSquare, FileDown, Mail, Calendar as CalendarIcon, Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { fmtBRL, fmtDate } from "@/lib/formatters";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { useQuery } from "@tanstack/react-query";

function ymKey(iso: string) {
  return iso.slice(0, 7); // YYYY-MM
}
function formatYM(ym: string) {
  const [y, m] = ym.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return format(date, "MMMM/yyyy", { locale: ptBR });
}
function formatDay(iso: string) {
  return format(new Date(iso + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR });
}
function fullName(e: { first_name: string | null; last_name: string | null }) {
  return [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
}

/* ──────────────── Export Open Folio para Excel ──────────────── */
function exportOpenFolioToExcel(
  entries: OpenFolioEntry[],
  notesByConf: Map<string, { note: string; expected_payment_date?: string | null; updated_at?: string; created_at: string }[]>,
  fileLabel: string,
) {
  if (!entries.length) {
    toast.error("Nenhum folio para exportar");
    return;
  }
  const fmt = (iso: string | null | undefined) =>
    iso ? format(new Date(iso + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "";
  const fmtDateTime = (iso: string | null | undefined) =>
    iso ? format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "";

  const rows = entries.map((e) => {
    const cn = e.confirmation_number ?? "";
    const cnNotes = notesByConf.get(cn) ?? [];
    const last = cnNotes[0];
    const expected = e.expected_payment_date ?? last?.expected_payment_date ?? null;
    const lastUpdate = last?.updated_at ?? last?.created_at ?? null;
    return {
      "Property Name": e.property_name_raw ?? "",
      "Confirmation Number": cn,
      "First Name": e.first_name ?? "",
      "Last Name": e.last_name ?? "",
      "Balance": Number(e.balance ?? 0),
      "Arrival Date": fmt(e.arrival_date),
      "Departure Date": fmt(e.departure_date),
      "Tempo em aberto (dias)": e.days_open ?? 0,
      "Justificativa GG": last?.note ?? "",
      "Data prevista de faturamento": fmt(expected),
      "Data da última atualização": fmtDateTime(lastUpdate),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 50 }, { wch: 22 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Open Folio");
  const stamp = format(new Date(), "yyyyMMdd_HHmm");
  const safeLabel = fileLabel.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  XLSX.writeFile(wb, `open_folio_${safeLabel}_${stamp}.xlsx`);
  toast.success(`${rows.length} folio(s) exportados`);
}

/* ──────────────── Export Faturamento para Excel ──────────────── */
function exportToInvoiceToExcel(
  entries: ToInvoiceEntry[],
  hotelName: (id: string | null) => string,
  contracts: ClientContract[] | undefined,
) {
  if (!entries.length) {
    toast.error("Nenhum lançamento para exportar");
    return;
  }
  const fmt = (iso: string | null | undefined) =>
    iso ? format(new Date(iso + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "";
  const rows = entries.map((e) => {
    const term = findContractTerm(contracts, e.account_number, e.account_name);
    const estimated =
      e.estimated_due_date ??
      (e.gg_confirmed_at && term != null
        ? addDays(e.gg_confirmed_at.slice(0, 10), term)
        : null);
    const statusLabel =
      e.gg_status === "faturado" ? "Faturado"
      : e.gg_status === "nao_faturado" ? "Não faturado"
      : "Pendente";
    return {
      "Hotel": hotelName(e.hotel_id),
      "Hóspede": e.account_name ?? "",
      "Valor": Number(e.amount ?? 0),
      "Faturado?": e.gg_status === "faturado" ? "Sim" : e.gg_status === "nao_faturado" ? "Não" : "Pendente",
      "Data Faturamento": e.gg_status === "faturado" && e.gg_confirmed_at
        ? format(new Date(e.gg_confirmed_at), "dd/MM/yyyy", { locale: ptBR })
        : "",
      "Pago?": e.paid_date ? "Sim" : e.paid_note ? "Não" : "",
      "Data Pagamento": fmt(e.paid_date),
      "Justificativa": e.paid_note ?? e.gg_note ?? "",
      "Vencimento Estimado": fmt(estimated),
      "Status": statusLabel,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 28 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
    { wch: 10 }, { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Faturamento");
  const stamp = format(new Date(), "yyyyMMdd_HHmm");
  XLSX.writeFile(wb, `faturamento_${stamp}.xlsx`);
  toast.success(`${rows.length} linha(s) exportadas`);
}

export default function ContasReceberPage() {
  const { hasRole, isMaster, userHotels, isFinanceiroCoordenadora, isFernando } = useAuth();
  const isManager = !isFernando && (isMaster || hasRole("financeiro"));
  // Quem pode importar relatórios AR: master ou coordenadora (equipe e GG não importam)
  const canImportAr = isMaster || isFinanceiroCoordenadora;
  // Quem vê todos os hotéis: master, financeiro, controladoria, ri
  const seesAllHotels =
    isMaster || hasRole("financeiro") || hasRole("controladoria") || hasRole("ri");
  // GG/GOP: somente os hotéis da sua cartela
  const isGgOnly = !seesAllHotels && hasRole("gg");
  const restrictedHotelIds = seesAllHotels ? null : userHotels.map((h) => h.id);
  const [tab, setTab] = useState<"to_invoice" | "open_folio">("to_invoice");

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Gestão · Financeiro</p>
        <h1 className="text-2xl font-semibold">Contas a Receber</h1>
        <p className="text-sm text-muted-foreground">
          Faturamento e folios em aberto consolidados a partir do Opera Cloud.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="to_invoice">Faturamento</TabsTrigger>
          <TabsTrigger value="open_folio">Open Folio</TabsTrigger>
        </TabsList>
        <TabsContent value="to_invoice" className="mt-5">
          <ToInvoiceSection
            isManager={isManager}
            canImportAr={canImportAr}
            seesAllHotels={seesAllHotels}
            restrictedHotelIds={restrictedHotelIds}
            isGgOnly={isGgOnly}
          />
        </TabsContent>
        <TabsContent value="open_folio" className="mt-5">
          <OpenFolioSection
            isManager={isManager}
            canImportAr={canImportAr}
            seesAllHotels={seesAllHotels}
            restrictedHotelIds={restrictedHotelIds}
            isGgOnly={isGgOnly}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ════════════════════ A FATURAR ════════════════════ */

function ToInvoiceSection({
  isManager,
  canImportAr,
  seesAllHotels,
  restrictedHotelIds,
  isGgOnly,
}: {
  isManager: boolean;
  canImportAr: boolean;
  seesAllHotels: boolean;
  restrictedHotelIds: string[] | null;
  isGgOnly: boolean;
}) {
  const { data: allHotels = [] } = useAllHotels();
  // Filtro global do header (Hotel) é a única fonte de verdade.
  const { hotelId: globalHotelId } = useModuleFilters("financeiro");
  const hotelId = globalHotelId ?? "";
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const [drillDay, setDrillDay] = useState<string | null>(null);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [faturamentoFilter, setFaturamentoFilter] = useState<"todos" | "pendente" | "faturado" | "pago">("todos");
  const [clientSearch, setClientSearch] = useState("");

  // Reset drill quando hotel muda
  useEffect(() => {
    setDrillMonth(null);
    setDrillDay(null);
  }, [hotelId]);

  const { data: entries = [], isLoading } = useToInvoiceEntries({
    hotelId: hotelId || undefined,
  });
  const { data: lastUpload } = useLatestArUpload("to_invoice");
  const { data: latestTiDate } = useLatestToInvoiceDate(hotelId || null);
  const { data: contracts } = useClientContracts(hotelId || null);
  const { data: tiUploads = [] } = useArUploadsByKind("to_invoice");

  const uploadDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of tiUploads) m.set(u.id, u.uploaded_at);
    return m;
  }, [tiUploads]);

  function daysSinceUpload(uploadId: string | null | undefined): number | null {
    if (!uploadId) return null;
    const iso = uploadDateById.get(uploadId);
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  const hotelName = (id: string | null) =>
    id ? allHotels.find((h) => h.id === id)?.name ?? id : "—";

  // Para o ranking consolidado, restringe entradas aos hotéis visíveis quando não master
  const visibleEntries = useMemo(() => {
    if (seesAllHotels) return entries;
    const allowed = new Set(restrictedHotelIds ?? []);
    return entries.filter((e) => e.hotel_id && allowed.has(e.hotel_id));
  }, [entries, seesAllHotels, restrictedHotelIds]);

  const pendingCount = useMemo(
    () => visibleEntries.filter((e) => e.gg_status === "pendente").length,
    [visibleEntries],
  );

  const filteredToInvoice = useMemo(
    () =>
      showOnlyPending
        ? visibleEntries.filter((e) => e.gg_status === "pendente")
        : visibleEntries,
    [visibleEntries, showOnlyPending],
  );

  const finalEntries = useMemo(() => {
    let arr = filteredToInvoice;
    if (faturamentoFilter !== "todos") {
      if (faturamentoFilter === "pago") {
        arr = arr.filter((e) => !!e.paid_date);
      } else {
        arr = arr.filter((e) => e.gg_status === faturamentoFilter);
      }
    }
    if (clientSearch.trim()) {
      const q = clientSearch.toLowerCase();
      arr = arr.filter(
        (e) =>
          e.account_name?.toLowerCase().includes(q) ||
          e.account_number?.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [filteredToInvoice, faturamentoFilter, clientSearch]);

  return (
    <div className="space-y-5">
      <UploadCard kind="to_invoice" lastUpload={lastUpload} isManager={canImportAr} />
      {latestTiDate && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 -mt-2 px-1">
          <CalendarIcon className="h-3.5 w-3.5" />
          Dados até <strong className="font-semibold">{fmtDate(latestTiDate)}</strong>
        </p>
      )}

      <Card className="p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground">Hotel</p>
            <p className="text-sm font-semibold">
              {hotelId ? hotelName(hotelId) : "Todos os hotéis (consolidado)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar por nome do cliente..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="w-56 h-9"
            />
            <Select value={faturamentoFilter} onValueChange={(v) => setFaturamentoFilter(v as typeof faturamentoFilter)}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendente">Pendentes</SelectItem>
                <SelectItem value="faturado">Faturados</SelectItem>
                <SelectItem value="pago">Pagos</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showOnlyPending ? "default" : "outline"}
              size="sm"
              onClick={() => setShowOnlyPending(!showOnlyPending)}
            >
              {showOnlyPending ? "Ver todos" : "Ver apenas pendentes"}
              {!showOnlyPending && pendingCount > 0 && (
                <Badge className="ml-2">{pendingCount}</Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={finalEntries.length === 0}
              onClick={() => exportToInvoiceToExcel(finalEntries, hotelName, contracts)}
            >
              <FileDown className="h-4 w-4" />
              Exportar Excel
            </Button>
            {hotelId && (
              <Button variant="outline" size="sm" onClick={() => setContractsOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Contratos do hotel
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/financeiro/contas-receber/clientes">
                <Plus className="h-4 w-4" /> Clientes
              </Link>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Table><TableBody><TableSkeleton rows={6} cols={5} /></TableBody></Table>
        ) : finalEntries.length === 0 ? (
          <EmptyState text="Nenhum lançamento de faturamento para os filtros selecionados." />
        ) : !hotelId ? (
          <ConsolidatedRanking entries={finalEntries} hotelName={hotelName} />
        ) : drillDay ? (
          <DayBreakdown
            entries={finalEntries.filter((e) => e.transaction_date === drillDay)}
            day={drillDay}
            contracts={contracts}
            onBack={() => setDrillDay(null)}
            daysSinceUpload={daysSinceUpload}
          />
        ) : drillMonth ? (
          <MonthBreakdown
            entries={finalEntries.filter((e) => e.transaction_date && ymKey(e.transaction_date) === drillMonth)}
            month={drillMonth}
            onPickDay={setDrillDay}
            onBack={() => setDrillMonth(null)}
          />
        ) : (
          <MonthlyOverview entries={finalEntries} onPickMonth={setDrillMonth} />
        )}
      </Card>

      {hotelId && (
        <ContractsDialog
          open={contractsOpen}
          onOpenChange={setContractsOpen}
          hotelId={hotelId}
          hotelName={hotelName(hotelId)}
        />
      )}
    </div>
  );
}

function MonthlyOverview({
  entries,
  onPickMonth,
}: {
  entries: ToInvoiceEntry[];
  onPickMonth: (m: string) => void;
}) {
  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (!e.transaction_date) continue;
      const k = ymKey(e.transaction_date);
      map.set(k, (map.get(k) ?? 0) + Number(e.amount ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  if (!monthly.length) return <EmptyState text="Sem datas de transação." />;
  const max = Math.max(...monthly.map((m) => m[1]));

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Total a faturar por mês — clique para detalhar
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {monthly.map(([ym, total]) => (
          <button
            key={ym}
            onClick={() => onPickMonth(ym)}
            className="text-left p-4 rounded-lg border bg-card hover:border-accent hover:shadow-soft transition-all"
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground capitalize">
              {formatYM(ym)}
            </p>
            <p className="text-xl font-semibold mt-1">{fmtBRL(total)}</p>
            <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${(total / max) * 100}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthBreakdown({
  entries,
  month,
  onPickDay,
  onBack,
}: {
  entries: ToInvoiceEntry[];
  month: string;
  onPickDay: (d: string) => void;
  onBack: () => void;
}) {
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (!e.transaction_date) continue;
      map.set(e.transaction_date, (map.get(e.transaction_date) ?? 0) + Number(e.amount ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <h3 className="text-sm font-semibold capitalize">{formatYM(month)} — por dia</h3>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead className="text-right">Lançamentos</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {daily.map(([day, total]) => {
              const count = entries.filter((e) => e.transaction_date === day).length;
              return (
                <TableRow key={day} className="cursor-pointer" onClick={() => onPickDay(day)}>
                  <TableCell className="font-medium">{formatDay(day)}</TableCell>
                  <TableCell className="text-right">{count}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtBRL(total)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">Ver clientes</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DayBreakdown({
  entries,
  day,
  contracts,
  onBack,
  daysSinceUpload,
}: {
  entries: ToInvoiceEntry[];
  day: string;
  contracts: ClientContract[] | undefined;
  onBack: () => void;
  daysSinceUpload?: (uploadId: string | null | undefined) => number | null;
}) {
  const { isMaster, hasRole } = useAuth();
  const canConfirm =
    isMaster ||
    hasRole("gg") ||
    hasRole("financeiro") ||
    hasRole("controladoria");
  const canFinanceiro = isMaster || hasRole("financeiro");
  const canAdmOrGg = isMaster || hasRole("adm") || hasRole("gg");
  const setStatus = useSetToInvoiceGgStatus();
  // Load clients for every hotel present in this day's entries
  const hotelIdsInDay = useMemo(
    () => Array.from(new Set(entries.map((e) => e.hotel_id).filter(Boolean) as string[])),
    [entries],
  );
  const clientsByHotel = useQuery({
    enabled: hotelIdsInDay.length > 0,
    queryKey: ["ar-clients-multi", hotelIdsInDay],
    queryFn: async (): Promise<Record<string, ArClient[]>> => {
      const { data, error } = await supabase
        .from("ar_clients")
        .select("*")
        .in("hotel_id", hotelIdsInDay)
        .order("name");
      if (error) throw error;
      const grouped: Record<string, ArClient[]> = {};
      for (const c of (data ?? []) as ArClient[]) {
        (grouped[c.hotel_id] ??= []).push(c);
      }
      return grouped;
    },
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [payFor, setPayFor] = useState<ToInvoiceEntry | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<{ entry: ToInvoiceEntry; term: number | null } | null>(null);
  const [problemFor, setProblemFor] = useState<ToInvoiceEntry | null>(null);
  const [notBillableFor, setNotBillableFor] = useState<ToInvoiceEntry | null>(null);
  const [defaultingFor, setDefaultingFor] = useState<ToInvoiceEntry | null>(null);
  const [sendDocsFor, setSendDocsFor] = useState<ToInvoiceEntry | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <h3 className="text-sm font-semibold">Lançamentos de {formatDay(day)}</h3>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Prazo</TableHead>
              <TableHead>Vencimento estimado</TableHead>
              <TableHead className="text-right">Dias pendente</TableHead>
              <TableHead>Confirmação GG</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const term = findContractTerm(contracts, e.account_number, e.account_name);
              const dueFromConfirm = term != null && e.gg_confirmed_at
                ? addDays(e.gg_confirmed_at.slice(0, 10), term)
                : null;
              const due = e.estimated_due_date ?? dueFromConfirm
                ?? (term != null && e.transaction_date ? addDays(e.transaction_date, term) : null);
              const isEditing = editingId === e.id;
              const dPending = e.gg_status === "pendente" ? (daysSinceUpload?.(e.upload_id) ?? null) : null;
              const pendingBadge = dPending == null ? null
                : dPending >= 60 ? { tone: "bg-red-900 text-white", label: `${dPending} dias` }
                : dPending >= 30 ? { tone: "bg-destructive text-destructive-foreground", label: `${dPending} dias` }
                : dPending >= 15 ? { tone: "bg-orange-500 text-white", label: `${dPending} dias` }
                : dPending >= 7  ? { tone: "bg-amber-400 text-black", label: `${dPending} dias` }
                : null;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{e.account_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{e.account_number ?? ""}</div>
                    {canAdmOrGg && e.hotel_id && (
                      <div className="pt-1">
                        <Select
                          value={e.client_id ?? "__none__"}
                          onValueChange={async (val) => {
                            await setStatus.mutateAsync({
                              id: e.id,
                              gg_status: e.gg_status,
                              gg_note: e.gg_note,
                              client_id: val === "__none__" ? null : val,
                            });
                            toast.success("Cliente vinculado");
                          }}
                        >
                          <SelectTrigger className="h-6 text-[11px]">
                            <SelectValue placeholder="Vincular cliente" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— sem cliente —</SelectItem>
                            {(clientsByHotel.data?.[e.hotel_id!] ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtBRL(e.amount)}</TableCell>
                  <TableCell className="text-right text-xs">
                    {term != null ? `${term} dias` : <span className="text-muted-foreground">sem contrato</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {due ? (
                      <>
                        {formatDay(due)}
                        {e.gg_status === "faturado" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">(Vence em)</span>
                        )}
                      </>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {pendingBadge ? (
                      <Badge className={`text-[10px] ${pendingBadge.tone}`}>{pendingBadge.label}</Badge>
                    ) : dPending != null ? (
                      <span className="text-muted-foreground">{dPending}d</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs space-y-1 min-w-[220px]">
                    <GgStatusBadge status={e.gg_status} />
                    {e.gg_note && (
                      <div className="text-[11px] text-muted-foreground italic">"{e.gg_note}"</div>
                    )}
                    {e.paid_date && (
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        Pago em {formatDay(e.paid_date)}
                      </div>
                    )}
                    {e.paid_note && !e.paid_date && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 italic">
                        Não pago: "{e.paid_note}"
                      </div>
                    )}
                    {canConfirm && !isEditing && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button
                          size="sm"
                          variant={e.gg_status === "faturado" ? "default" : "outline"}
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setInvoiceFor({ entry: e, term })}
                        >
                          Faturado
                        </Button>
                        <Button
                          size="sm"
                          variant={e.gg_status === "nao_faturado" ? "default" : "outline"}
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setEditingId(e.id);
                            setNoteDraft(e.gg_note ?? "");
                          }}
                        >
                          Não faturado
                        </Button>
                        <Button
                          size="sm"
                          variant={e.paid_date || e.paid_note ? "default" : "outline"}
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setPayFor(e)}
                        >
                          Pago
                        </Button>
                        {canFinanceiro && (
                          <Button
                            size="sm"
                            variant={e.documents_problem_at ? "default" : "outline"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setProblemFor(e)}
                          >
                            Problema docs
                          </Button>
                        )}
                        {canFinanceiro && (
                          <Button
                            size="sm"
                            variant={e.gg_status === "inadimplente" ? "default" : "outline"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setDefaultingFor(e)}
                          >
                            Inadimplente
                          </Button>
                        )}
                        {canAdmOrGg && (
                          <Button
                            size="sm"
                            variant={e.gg_status === "nao_faturavel" ? "default" : "outline"}
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setNotBillableFor(e)}
                          >
                            Não faturável
                          </Button>
                        )}
                        {canAdmOrGg && e.gg_status === "pendente" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setSendDocsFor(e)}
                          >
                            Enviar docs
                          </Button>
                        )}
                      </div>
                    )}
                    {canConfirm && isEditing && (
                      <div className="flex flex-col gap-1 pt-1">
                        <Textarea
                          value={noteDraft}
                          onChange={(ev) => setNoteDraft(ev.target.value)}
                          placeholder="Observação (opcional)"
                          className="h-14 text-[11px]"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={async () => {
                              await setStatus.mutateAsync({
                                id: e.id,
                                gg_status: "nao_faturado",
                                gg_note: noteDraft.trim() || null,
                              });
                              setEditingId(null);
                            }}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <PaymentDialog
        entry={payFor}
        onClose={() => setPayFor(null)}
        onSave={async (paid, dateOrNote) => {
          if (!payFor) return;
          await setStatus.mutateAsync({
            id: payFor.id,
            gg_status: payFor.gg_status,
            gg_note: payFor.gg_note,
            paid_date: paid ? dateOrNote : null,
            paid_note: paid ? null : dateOrNote,
          });
          setPayFor(null);
          toast.success(paid ? "Pagamento registrado" : "Justificativa registrada");
        }}
      />
      <InvoiceUploadDialog
        entry={invoiceFor?.entry ?? null}
        onClose={() => setInvoiceFor(null)}
        onConfirm={async (file1Url, file2Url) => {
          if (!invoiceFor) return;
          const term = invoiceFor.term;
          const estimated = term != null
            ? addDays(new Date().toISOString().slice(0, 10), term)
            : null;
          await setStatus.mutateAsync({
            id: invoiceFor.entry.id,
            gg_status: "faturado",
            gg_note: invoiceFor.entry.gg_note,
            estimated_due_date: estimated,
            invoice_file_1: file1Url,
            invoice_file_2: file2Url,
            billed_at: new Date().toISOString(),
          });
          setInvoiceFor(null);
          toast.success("Marcado como faturado");
        }}
      />
      <ProblemDocsDialog
        entry={problemFor}
        onClose={() => setProblemFor(null)}
        onConfirm={async (note) => {
          if (!problemFor) return;
          await setStatus.mutateAsync({
            id: problemFor.id,
            gg_status: "pendente",
            gg_note: problemFor.gg_note,
            documents_problem_note: note,
            documents_problem_at: new Date().toISOString(),
          });
          setProblemFor(null);
          toast.success("Problema registrado. Adm/GG serão avisados.");
        }}
      />
      <DefaultingDialog
        entry={defaultingFor}
        onClose={() => setDefaultingFor(null)}
        onConfirm={async (note) => {
          if (!defaultingFor) return;
          await setStatus.mutateAsync({
            id: defaultingFor.id,
            gg_status: "inadimplente",
            gg_note: defaultingFor.gg_note,
            is_defaulting: true,
            defaulting_note: note,
            defaulting_at: new Date().toISOString(),
          });
          setDefaultingFor(null);
          toast.success("Marcado como inadimplente");
        }}
      />
      <NotBillableDialog
        entry={notBillableFor}
        onClose={() => setNotBillableFor(null)}
        onConfirm={async (reason, note) => {
          if (!notBillableFor) return;
          await setStatus.mutateAsync({
            id: notBillableFor.id,
            gg_status: "nao_faturavel",
            gg_note: notBillableFor.gg_note,
            is_not_billable: true,
            not_billable_reason: reason,
            not_billable_note: note,
          });
          setNotBillableFor(null);
          toast.success("Marcado como não faturável");
        }}
      />
      <SendDocsDialog
        entry={sendDocsFor}
        onClose={() => setSendDocsFor(null)}
        onConfirm={async (file1, file2, proof) => {
          if (!sendDocsFor) return;
          await setStatus.mutateAsync({
            id: sendDocsFor.id,
            gg_status: "documentos_enviados",
            gg_note: sendDocsFor.gg_note,
            invoice_file_1: file1,
            invoice_file_2: file2,
            proof_file: proof,
          });
          setSendDocsFor(null);
          toast.success("Documentos enviados ao Financeiro");
        }}
      />
    </div>
  );
}

function InvoiceUploadDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onConfirm: (file1Url: string, file2Url: string | null) => Promise<void>;
}) {
  const [file1Url, setFile1Url] = useState<string | null>(null);
  const [file2Url, setFile2Url] = useState<string | null>(null);
  const [uploading1, setUploading1] = useState(false);
  const [uploading2, setUploading2] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      setFile1Url(entry.invoice_file_1 ?? null);
      setFile2Url(entry.invoice_file_2 ?? null);
    } else {
      setFile1Url(null);
      setFile2Url(null);
    }
  }, [entry]);

  async function openStoredFile(value: string) {
    // Compat: rows previously stored a public URL; new rows store the storage path.
    if (/^https?:\/\//i.test(value)) {
      window.open(value, "_blank", "noopener");
      return;
    }
    const { data, error } = await supabase.storage
      .from("invoices")
      .createSignedUrl(value, 60 * 10);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o arquivo");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function handleUpload(file: File, slot: 1 | 2) {
    if (!entry) return;
    const setLoading = slot === 1 ? setUploading1 : setUploading2;
    setLoading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${entry.hotel_id ?? "unknown"}/${entry.id}/${Date.now()}-${slot}.${ext}`;
      const { error } = await supabase.storage
        .from("invoices")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      if (slot === 1) setFile1Url(path);
      else setFile2Url(path);
      toast.success(`Arquivo ${slot} enviado`);
    } catch (err) {
      toast.error(`Falha ao enviar arquivo: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como faturado</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">
              Nota Fiscal / Boleto <span className="text-destructive">*</span>
            </Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              disabled={uploading1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, 1);
              }}
            />
            {file1Url && (
              <button
                type="button"
                onClick={() => openStoredFile(file1Url)}
                className="text-[11px] text-primary underline truncate block text-left"
              >
                Arquivo 1 enviado ✓
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Arquivo adicional (opcional)</Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              disabled={uploading2}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, 2);
              }}
            />
            {file2Url && (
              <button
                type="button"
                onClick={() => openStoredFile(file2Url)}
                className="text-[11px] text-primary underline truncate block text-left"
              >
                Arquivo 2 enviado ✓
              </button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={!file1Url || uploading1 || uploading2 || saving}
            onClick={async () => {
              if (!file1Url) return;
              setSaving(true);
              try {
                await onConfirm(file1Url, file2Url);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  entry,
  onClose,
  onSave,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onSave: (paid: boolean, dateOrNote: string) => Promise<void>;
}) {
  const [paidChoice, setPaidChoice] = useState<"yes" | "no" | null>(null);
  const [paidDate, setPaidDate] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (entry) {
      setPaidChoice(entry.paid_date ? "yes" : entry.paid_note ? "no" : null);
      setPaidDate(entry.paid_date ?? "");
      setReason(entry.paid_note ?? "");
    }
  }, [entry]);
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Foi pago?</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={paidChoice === "yes" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaidChoice("yes")}
            >
              Sim
            </Button>
            <Button
              variant={paidChoice === "no" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaidChoice("no")}
            >
              Não
            </Button>
          </div>
          {paidChoice === "yes" && (
            <div>
              <Label className="text-xs">Data do pagamento</Label>
              <input
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          )}
          {paidChoice === "no" && (
            <div>
              <Label className="text-xs">Justificativa</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Por que ainda não foi pago?"
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={
              !paidChoice ||
              (paidChoice === "yes" && !paidDate) ||
              (paidChoice === "no" && !reason.trim())
            }
            onClick={() => onSave(paidChoice === "yes", paidChoice === "yes" ? paidDate : reason.trim())}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GgStatusBadge({ status }: { status: ToInvoiceEntry["gg_status"] }) {
  if (status === "faturado")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Faturado</Badge>;
  if (status === "nao_faturado")
    return <Badge variant="destructive">Não faturado</Badge>;
  if (status === "documentos_enviados")
    return <Badge className="bg-sky-600 hover:bg-sky-600 text-white">Docs enviados</Badge>;
  if (status === "nao_faturavel")
    return <Badge className="bg-zinc-500 hover:bg-zinc-500 text-white">Não faturável</Badge>;
  if (status === "pago")
    return <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white">Pago</Badge>;
  if (status === "inadimplente")
    return <Badge className="bg-red-700 hover:bg-red-700 text-white">Inadimplente</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
}

function ProblemDocsDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  useEffect(() => { setNote(entry?.documents_problem_note ?? ""); }, [entry?.id]);
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Problema nos documentos</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Descreva o problema</Label>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que está incorreto nos documentos?" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DefaultingDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  useEffect(() => { setNote(entry?.defaulting_note ?? ""); }, [entry?.id]);
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como inadimplente</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Justificativa</Label>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Detalhes da inadimplência" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NOT_BILLABLE_REASONS = [
  "Cortesia",
  "No-show coberto",
  "Estorno",
  "Erro de lançamento",
  "Compensação interna",
  "Outro",
];

function NotBillableDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onConfirm: (reason: string, note: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setReason(entry?.not_billable_reason ?? "");
    setNote(entry?.not_billable_note ?? "");
  }, [entry?.id]);
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Não vai ser faturado</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Motivo *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {NOT_BILLABLE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!reason} onClick={() => onConfirm(reason, note.trim() || null)}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDocsDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ToInvoiceEntry | null;
  onClose: () => void;
  onConfirm: (file1: string | null, file2: string | null, proof: string | null) => Promise<void>;
}) {
  const [file1, setFile1] = useState<string | null>(null);
  const [file2, setFile2] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 1 | 2 | 3>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setFile1(entry?.invoice_file_1 ?? null);
    setFile2(entry?.invoice_file_2 ?? null);
    setProof(entry?.proof_file ?? null);
  }, [entry?.id]);
  async function handleUpload(file: File, slot: 1 | 2 | 3) {
    if (!entry) return;
    setBusy(slot);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${entry.hotel_id ?? "unknown"}/${entry.id}/send-${slot}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("invoices")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      if (slot === 1) setFile1(path);
      else if (slot === 2) setFile2(path);
      else setProof(path);
      toast.success("Arquivo enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar documentos</DialogTitle>
          <DialogDescription>
            {entry && <>{entry.account_name ?? "—"} · {fmtBRL(entry.amount)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {([1, 2, 3] as const).map((slot) => {
            const cur = slot === 1 ? file1 : slot === 2 ? file2 : proof;
            const label = slot === 1 ? "NF / Boleto 1" : slot === 2 ? "NF / Boleto 2 (opcional)" : "Comprovante de envio";
            return (
              <div key={slot} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) handleUpload(f, slot);
                      ev.target.value = "";
                    }}
                    disabled={busy === slot}
                    className="text-xs"
                  />
                  {busy === slot && <Loader2 className="h-3 w-3 animate-spin" />}
                  {cur && <Badge variant="secondary" className="text-[10px]">ok</Badge>}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={saving || !file1 || !proof}
            onClick={async () => {
              setSaving(true);
              try { await onConfirm(file1, file2, proof); } finally { setSaving(false); }
            }}
          >
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsolidatedRanking({
  entries,
  hotelName,
}: {
  entries: ToInvoiceEntry[];
  hotelName: (id: string | null) => string;
}) {
  const ranking = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const id = e.hotel_id ?? "__unmapped__";
      map.set(id, (map.get(id) ?? 0) + Number(e.amount ?? 0));
    }
    return Array.from(map.entries())
      .map(([id, total]) => ({ id, name: id === "__unmapped__" ? "(não mapeado)" : hotelName(id), total }))
      .sort((a, b) => b.total - a.total);
  }, [entries, hotelName]);

  if (!ranking.length) return <EmptyState text="Sem dados consolidados." />;
  const max = ranking[0].total;
  const grand = ranking.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Ranking por hotel</h3>
        <span className="text-xs text-muted-foreground">Total: <strong>{fmtBRL(grand)}</strong></span>
      </div>
      <div className="space-y-2">
        {ranking.map((r) => (
          <div key={r.id} className="flex items-center gap-3">
            <div className="w-48 text-sm truncate">{r.name}</div>
            <div className="flex-1 h-7 rounded bg-muted/40 overflow-hidden relative">
              <div
                className="h-full bg-accent/80 flex items-center justify-end pr-2 text-[11px] font-semibold text-accent-foreground"
                style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }}
              >
                {fmtBRL(r.total)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════ OPEN FOLIO ════════════════════ */

function OpenFolioSection({
  isManager,
  canImportAr,
  seesAllHotels,
  restrictedHotelIds,
  isGgOnly,
}: {
  isManager: boolean;
  canImportAr: boolean;
  seesAllHotels: boolean;
  restrictedHotelIds: string[] | null;
  isGgOnly: boolean;
}) {
  const { data: hotels = [] } = useAllHotels();
  const { data: entries = [], isLoading } = useOpenFolioEntries();
  const { data: lastUpload } = useLatestArUpload("open_folio");
  const { data: allNotes = [] } = useAllOpenFolioNotes();
  // Filtro global do header (Hotel) é a única fonte de verdade.
  const { hotelId: globalHotelId, setHotelId } = useModuleFilters("financeiro");
  const selectedHotel = globalHotelId;
  const [agingFilter, setAgingFilter] = useState<"all" | "fresh" | "mid" | "old">("all");
  const [unjustifiedOnly, setUnjustifiedOnly] = useState(false);
  const [notifying, setNotifying] = useState<string | null>(null);
  const [ofSearchText, setOfSearchText] = useState<string>("");
  const [ofSort, setOfSort] = useState<{
    col: "guest_name" | "balance" | "arrival_date" | "departure_date" | "days_open";
    dir: "asc" | "desc";
  }>({ col: "balance", dir: "desc" });

  // confirmation_numbers que possuem ao menos uma justificativa, indexados por hotel
  const justifiedByHotel = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const n of allNotes) {
      if (!n.note?.trim()) continue;
      const set = m.get(n.hotel_id) ?? new Set<string>();
      set.add(n.confirmation_number);
      m.set(n.hotel_id, set);
    }
    return m;
  }, [allNotes]);

  const isJustified = (e: OpenFolioEntry) => {
    if (!e.hotel_id || !e.confirmation_number) return false;
    return justifiedByHotel.get(e.hotel_id)?.has(e.confirmation_number) ?? false;
  };

  async function notifyGgForHotel(hotelId: string, hotelName: string) {
    setNotifying(hotelId);
    try {
      const { data, error } = await supabase.functions.invoke("notify-gg-open-folio", {
        body: { hotel_id: hotelId },
      });
      if (error) throw error;
      const result = data as { hotels_notified?: number } | null;
      if ((result?.hotels_notified ?? 0) > 0) {
        toast.success(`GG de ${hotelName} notificado por e-mail`);
      } else {
        toast.warning(`Nenhum GG ativo encontrado para ${hotelName}`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao notificar GG");
    } finally {
      setNotifying(null);
    }
  }

  const allowedSet = useMemo(
    () => (seesAllHotels ? null : new Set(restrictedHotelIds ?? [])),
    [seesAllHotels, restrictedHotelIds],
  );
  const visibleEntries = useMemo(
    () => (allowedSet ? entries.filter((e) => e.hotel_id && allowedSet.has(e.hotel_id)) : entries),
    [entries, allowedSet],
  );

  const summaries = useMemo(() => {
    const map = new Map<string, { count: number; total: number; daysSum: number; daysCount: number; unjustified: number }>();
    for (const e of visibleEntries) {
      if (!e.hotel_id) continue;
      const cur = map.get(e.hotel_id) ?? { count: 0, total: 0, daysSum: 0, daysCount: 0, unjustified: 0 };
      cur.count++;
      cur.total += Number(e.balance ?? 0);
      if (e.days_open != null) {
        cur.daysSum += e.days_open;
        cur.daysCount++;
      }
      if (!isJustified(e)) cur.unjustified++;
      map.set(e.hotel_id, cur);
    }
    const hotelById = new Map(hotels.map((h) => [h.id, h]));
    return Array.from(map.entries())
      .map(([id, v]) => ({
        id,
        name: hotelById.get(id)?.name ?? id,
        count: v.count,
        total: v.total,
        avgDays: v.daysCount ? Math.round(v.daysSum / v.daysCount) : 0,
        unjustified: v.unjustified,
      }))
      .sort((a, b) => b.total - a.total);
  }, [visibleEntries, hotels, justifiedByHotel]);

  const filteredEntries = useMemo(() => {
    if (!selectedHotel) return [];
    const base = visibleEntries
      .filter((e) => e.hotel_id === selectedHotel)
      .filter((e) => {
        if (agingFilter === "all") return true;
        const d = e.days_open ?? 0;
        if (agingFilter === "fresh") return d <= 30;
        if (agingFilter === "mid") return d > 30 && d <= 90;
        return d > 90;
      })
      .filter((e) => (unjustifiedOnly ? !isJustified(e) : true));

    const q = ofSearchText.trim().toLowerCase();
    const searched = q
      ? base.filter((e) => {
          const name = `${e.first_name ?? ""} ${e.last_name ?? ""}`.toLowerCase();
          return (
            name.includes(q) ||
            (e.confirmation_number ?? "").toLowerCase().includes(q)
          );
        })
      : base;

    const sorted = [...searched].sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      if (ofSort.col === "guest_name") {
        va = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
        vb = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
      } else if (ofSort.col === "balance") {
        va = Number(a.balance ?? 0);
        vb = Number(b.balance ?? 0);
      } else if (ofSort.col === "days_open") {
        va = Number(a.days_open ?? 0);
        vb = Number(b.days_open ?? 0);
      } else {
        va = a[ofSort.col] ?? "";
        vb = b[ofSort.col] ?? "";
      }
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return ofSort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [visibleEntries, selectedHotel, agingFilter, unjustifiedOnly, justifiedByHotel, ofSearchText, ofSort]);

  const handleOfSort = (col: typeof ofSort.col) => {
    setOfSort((s) => ({
      col,
      dir: s.col === col && s.dir === "desc" ? "asc" : "desc",
    }));
  };

  return (
    <div className="space-y-5">
      <UploadCard kind="open_folio" lastUpload={lastUpload} isManager={canImportAr} />

      {isLoading ? (
        <Table><TableBody><TableSkeleton rows={6} cols={5} /></TableBody></Table>
      ) : selectedHotel ? (
        <HotelOpenFolioDetail
          hotelId={selectedHotel}
          hotelName={hotels.find((h) => h.id === selectedHotel)?.name ?? selectedHotel}
          entries={filteredEntries}
          agingFilter={agingFilter}
          setAgingFilter={setAgingFilter}
          unjustifiedOnly={unjustifiedOnly}
          setUnjustifiedOnly={setUnjustifiedOnly}
          unjustifiedCount={summaries.find((s) => s.id === selectedHotel)?.unjustified ?? 0}
          totalCount={summaries.find((s) => s.id === selectedHotel)?.count ?? 0}
          onNotifyGg={isManager ? () => notifyGgForHotel(selectedHotel, hotels.find((h) => h.id === selectedHotel)?.name ?? selectedHotel) : undefined}
          notifying={notifying === selectedHotel}
          onBack={() => setHotelId(null)}
          hideBack={isGgOnly}
          searchText={ofSearchText}
          setSearchText={setOfSearchText}
          sort={ofSort}
          onSort={handleOfSort}
        />
      ) : (
        <Card className="p-5 shadow-soft space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Folios em aberto por hotel</h3>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={visibleEntries.length === 0}
              onClick={() => exportOpenFolioToExcel(visibleEntries, new Map(), "consolidado")}
            >
              <FileDown className="h-4 w-4" />
              Exportar para Excel
            </Button>
          </div>
          {summaries.length === 0 ? (
            <EmptyState text="Nenhum folio em aberto." />
          ) : (
            <div className="space-y-2">
              {summaries.map((s) => {
                const tone =
                  s.avgDays > 90 ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : s.avgDays > 30 ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400";
                return (
                  <div
                    key={s.id}
                    className="w-full text-left p-4 rounded-lg border hover:border-accent hover:shadow-soft transition-all flex items-center gap-4"
                  >
                    <button
                      onClick={() => setHotelId(s.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="font-semibold truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.count} folio(s) em aberto
                        {s.unjustified > 0 && (
                          <> · <span className="text-amber-600 font-medium">{s.unjustified} sem justificativa</span></>
                        )}
                      </p>
                    </button>
                    <div className="text-right">
                      <p className="text-lg font-semibold">{fmtBRL(s.total)}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${tone}`}>
                        média {s.avgDays}d
                      </span>
                    </div>
                    {/* Notificação automática após upload — botão manual removido */}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function HotelOpenFolioDetail({
  hotelId,
  hotelName,
  entries,
  agingFilter,
  setAgingFilter,
  unjustifiedOnly,
  setUnjustifiedOnly,
  unjustifiedCount,
  totalCount,
  onNotifyGg,
  notifying,
  onBack,
  hideBack,
  searchText,
  setSearchText,
  sort,
  onSort,
}: {
  hotelId: string;
  hotelName: string;
  entries: OpenFolioEntry[];
  agingFilter: "all" | "fresh" | "mid" | "old";
  setAgingFilter: (v: "all" | "fresh" | "mid" | "old") => void;
  unjustifiedOnly: boolean;
  setUnjustifiedOnly: (v: boolean) => void;
  unjustifiedCount: number;
  totalCount: number;
  onNotifyGg?: () => void;
  notifying?: boolean;
  onBack: () => void;
  hideBack?: boolean;
  searchText: string;
  setSearchText: (v: string) => void;
  sort: { col: "guest_name" | "balance" | "arrival_date" | "departure_date" | "days_open"; dir: "asc" | "desc" };
  onSort: (col: "guest_name" | "balance" | "arrival_date" | "departure_date" | "days_open") => void;
}) {
  const { data: notes = [] } = useOpenFolioNotes(hotelId);
  const [noteFor, setNoteFor] = useState<OpenFolioEntry | null>(null);

  const notesByConf = useMemo(() => {
    const m = new Map<string, typeof notes>();
    for (const n of notes) {
      const list = m.get(n.confirmation_number) ?? [];
      list.push(n);
      m.set(n.confirmation_number, list);
    }
    return m;
  }, [notes]);

  return (
    <Card className="p-5 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {!hideBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          )}
          <h3 className="text-sm font-semibold">{hotelName}</h3>
          {totalCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {totalCount} folio(s)
              {unjustifiedCount > 0 && (
                <span className="ml-1 text-amber-600">· {unjustifiedCount} sem justificativa</span>
              )}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={unjustifiedOnly ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setUnjustifiedOnly(!unjustifiedOnly)}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Sem justificativa
            {unjustifiedCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{unjustifiedCount}</Badge>
            )}
          </Button>
          <Select value={agingFilter} onValueChange={(v) => setAgingFilter(v as typeof agingFilter)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="fresh">Até 30 dias</SelectItem>
              <SelectItem value="mid">31 a 90 dias</SelectItem>
              <SelectItem value="old">Acima de 90 dias</SelectItem>
            </SelectContent>
          </Select>
          {/* Notificação automática após upload — botão manual removido */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={entries.length === 0}
            onClick={() => exportOpenFolioToExcel(entries, notesByConf, hotelName)}
          >
            <FileDown className="h-4 w-4" />
            Exportar Excel
          </Button>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Buscar hóspede ou nº de confirmação..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead col="guest_name" label="Hóspede" sort={sort} onSort={onSort} />
              <TableHead>Confirmação</TableHead>
              <SortableHead col="balance" label="Saldo" sort={sort} onSort={onSort} align="right" />
              <SortableHead col="arrival_date" label="Check-in" sort={sort} onSort={onSort} />
              <SortableHead col="departure_date" label="Check-out" sort={sort} onSort={onSort} />
              <SortableHead col="days_open" label="Em aberto" sort={sort} onSort={onSort} align="right" />
              <TableHead>Previsto fechamento</TableHead>
              <TableHead>Justificativa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">Nenhum folio.</TableCell></TableRow>
            ) : (
              entries.map((e) => {
                const cn = e.confirmation_number ?? "";
                const cnNotes = notesByConf.get(cn) ?? [];
                const last = cnNotes[0];
                const aging = e.days_open ?? 0;
                const tone = aging > 90 ? "text-destructive" : aging > 30 ? "text-amber-600" : "text-muted-foreground";
                const expected = e.expected_payment_date ?? last?.expected_payment_date ?? null;
                const todayIso = new Date().toISOString().slice(0, 10);
                const overdue = expected && expected < todayIso;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">
                      <div>{fullName(e)}</div>
                      {(e.company || e.travel_agent) && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                          {e.company && <span>🏢 {e.company}</span>}
                          {e.company && e.travel_agent && <span> · </span>}
                          {e.travel_agent && <span>✈ {e.travel_agent}</span>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{cn || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtBRL(e.balance)}</TableCell>
                    <TableCell className="text-xs">{e.arrival_date ? formatDay(e.arrival_date) : "—"}</TableCell>
                    <TableCell className="text-xs">{e.departure_date ? formatDay(e.departure_date) : "—"}</TableCell>
                    <TableCell className={`text-right text-xs font-semibold ${tone}`}>{aging}d</TableCell>
                    <TableCell className="text-xs">
                      {expected ? (
                        <span className={overdue ? "text-destructive font-semibold" : ""}>
                          {formatDay(expected)}
                          {overdue && <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0">vencido</Badge>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {last ? (
                          <span className="text-xs text-muted-foreground line-clamp-2 max-w-[220px]">{last.note}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Sem justificativa</span>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setNoteFor(e)}>
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <NoteDialog
        entry={noteFor}
        hotelId={hotelId}
        existingNotes={noteFor ? notesByConf.get(noteFor.confirmation_number ?? "") ?? [] : []}
        onClose={() => setNoteFor(null)}
      />
    </Card>
  );
}

function NoteDialog({
  entry,
  hotelId,
  existingNotes,
  onClose,
}: {
  entry: OpenFolioEntry | null;
  hotelId: string;
  existingNotes: { id: string; note: string; created_at: string; expected_payment_date?: string | null }[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const upsert = useUpsertOpenFolioNote();

  async function save() {
    if (!entry?.confirmation_number || !user || !text.trim()) return;
    try {
      await upsert.mutateAsync({
        hotel_id: hotelId,
        confirmation_number: entry.confirmation_number,
        note: text.trim(),
        author_id: user.id,
        expected_payment_date: expectedDate || null,
      });
      toast.success("Justificativa registrada");
      setText("");
      setExpectedDate("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Justificativa do folio</DialogTitle>
          <DialogDescription>
            {entry && <>{fullName(entry)} · {entry.confirmation_number} · {fmtBRL(entry.balance)}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {existingNotes.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded p-2">
              {existingNotes.map((n) => (
                <div key={n.id} className="text-xs border-b last:border-0 pb-1.5">
                  <p className="text-muted-foreground">{format(new Date(n.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                  <p>{n.note}</p>
                </div>
              ))}
            </div>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex: cliente vai pagar semana que vem, em negociação, cobrança enviada…"
            rows={4}
          />
          <div>
            <Label className="text-xs">Data prevista de fechamento (opcional)</Label>
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={upsert.isPending || !text.trim()}>
            {upsert.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════ CONTRATOS ════════════════════ */

function ContractsDialog({
  open,
  onOpenChange,
  hotelId,
  hotelName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hotelId: string;
  hotelName: string;
}) {
  const { user, isMaster, hasRole } = useAuth();
  const canEdit = isMaster || hasRole("financeiro") || hasRole("gg");
  const { data: contracts = [] } = useClientContracts(hotelId);
  const upsert = useUpsertContract();
  const del = useDeleteContract();
  const [form, setForm] = useState({ account_number: "", account_name: "", payment_term_days: "", notes: "" });
  const [contractToDelete, setContractToDelete] = useState<
    { id: string; hotel_id: string } | null
  >(null);

  async function add() {
    if (!user) return;
    if (!form.account_number && !form.account_name) {
      toast.error("Informe Account Number ou Account Name");
      return;
    }
    const days = parseInt(form.payment_term_days);
    if (isNaN(days) || days < 0) {
      toast.error("Prazo inválido");
      return;
    }
    try {
      await upsert.mutateAsync({
        hotel_id: hotelId,
        account_number: form.account_number.trim() || null,
        account_name: form.account_name.trim() || null,
        payment_term_days: days,
        notes: form.notes.trim() || null,
        created_by: user.id,
      });
      toast.success("Contrato salvo");
      setForm({ account_number: "", account_name: "", payment_term_days: "", notes: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Contratos — {hotelName}</DialogTitle>
          <DialogDescription>
            Prazo de recebimento por cliente. Vencimento estimado = data da transação + prazo.
          </DialogDescription>
        </DialogHeader>

        {canEdit && (
          <div className="grid grid-cols-12 gap-2 items-end border rounded p-3 bg-muted/30">
            <div className="col-span-3">
              <Label className="text-xs">Account Number</Label>
              <Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
            </div>
            <div className="col-span-4">
              <Label className="text-xs">Account Name</Label>
              <Input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Prazo (dias)</Label>
              <Input type="number" min={0} value={form.payment_term_days} onChange={(e) => setForm({ ...form, payment_term_days: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Obs.</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button size="sm" onClick={add} disabled={upsert.isPending} className="col-span-1">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="rounded border overflow-hidden max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Number</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead className="text-right">Prazo</TableHead>
                <TableHead>Obs.</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Nenhum contrato cadastrado.</TableCell></TableRow>
              ) : (
                contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.account_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.account_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{c.payment_term_days} dias</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.notes ?? ""}</TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setContractToDelete({ id: c.id, hotel_id: hotelId })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={!!contractToDelete}
      onOpenChange={(open) => { if (!open) setContractToDelete(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover contrato?</AlertDialogTitle>
          <AlertDialogDescription>
            O prazo de pagamento desta conta será removido. Isso pode afetar
            o cálculo de vencimentos no Open Folio.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              if (!contractToDelete) return;
              try {
                await del.mutateAsync(contractToDelete);
                toast.success("Contrato removido");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro");
              } finally {
                setContractToDelete(null);
              }
            }}
          >
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/* ════════════════════ COMPARTILHADOS ════════════════════ */

function UploadCard({
  kind,
  lastUpload,
  isManager,
}: {
  kind: "to_invoice" | "open_folio";
  lastUpload: { uploaded_at: string; file_name: string; parsed_rows_count: number | null; unmapped_properties: unknown } | null | undefined;
  isManager: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const upload = useUploadArReport();
  const deleteUpload = useDeleteArUpload();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const res = await upload.mutateAsync({ file: f, kind });
      const unmapped = (res?.unmapped_properties ?? []) as string[];
      let undone = false;
      const baseMsg = `${res.entries} linha(s) processadas`;
      if (unmapped.length) {
        toast.warning(`${baseMsg}. ${unmapped.length} hotel(éis) não mapeado(s) — configure em Hotéis.`, {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              undone = true;
              try {
                await deleteUpload.mutateAsync({ uploadId: res.upload_id, kind });
                toast.success("Upload revertido.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao reverter");
              }
            },
          },
        });
      } else {
        toast.success(baseMsg, {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              undone = true;
              try {
                await deleteUpload.mutateAsync({ uploadId: res.upload_id, kind });
                toast.success("Upload revertido.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao reverter");
              }
            },
          },
        });
      }
      // Notificação automática ao GG (somente se não desfeito após 8s)
      setTimeout(async () => {
        if (undone) return;
        const fn = kind === "to_invoice" ? "notify-gg-to-invoice" : "notify-gg-open-folio";
        try {
          await supabase.functions.invoke(fn, { body: { upload_id: res.upload_id } });
        } catch (err) {
          // silencioso: notificação automática é best-effort
          console.warn(`[${fn}] falha:`, err);
        }
      }, 8500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const unmapped = (lastUpload?.unmapped_properties as string[] | undefined) ?? [];

  return (
    <Card className="p-4 shadow-soft">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent" />
            {kind === "to_invoice" ? "Importar relatório Faturamento" : "Importar relatório Open Folio"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {kind === "to_invoice"
              ? "Acumulativo. Cada upload soma ao histórico (linhas duplicadas são ignoradas)."
              : "Substitui completamente o anterior. Os GGs serão notificados automaticamente."}
          </p>
          {lastUpload && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Último upload: <strong>{format(new Date(lastUpload.uploaded_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</strong> ·{" "}
              {lastUpload.file_name} · {lastUpload.parsed_rows_count ?? 0} linhas
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onFile}
          disabled={!isManager || uploading}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={!isManager || uploading} className="gap-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar Relatório
        </Button>
      </div>
      {!isManager && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Apenas usuários com perfil <strong>Financeiro</strong> ou <strong>Master</strong> podem fazer upload.
        </p>
      )}
      {unmapped.length > 0 && (
        <div className="mt-3 p-2 rounded border border-amber-500/30 bg-amber-500/10 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>{unmapped.length} hotel(éis) não mapeado(s)</strong> no último upload:{" "}
            {unmapped.slice(0, 5).map((u, i) => (
              <Badge key={i} variant="outline" className="ml-1 text-[10px]">{u}</Badge>
            ))}
            {unmapped.length > 5 && <span className="ml-1">+{unmapped.length - 5}</span>}
            <p className="mt-1 text-muted-foreground">
              Configure o "Nome no Opera Cloud" em <strong>Configurações → Hotéis</strong>.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-10 text-sm text-muted-foreground">
      <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
      {text}
    </div>
  );
}

type OfSortCol = "guest_name" | "balance" | "arrival_date" | "departure_date" | "days_open";

function SortableHead({
  col,
  label,
  sort,
  onSort,
  align,
}: {
  col: OfSortCol;
  label: string;
  sort: { col: OfSortCol; dir: "asc" | "desc" };
  onSort: (col: OfSortCol) => void;
  align?: "left" | "right";
}) {
  const active = sort.col === col;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:text-accent ${align === "right" ? "text-right" : ""}`}
      onClick={() => onSort(col)}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </div>
    </TableHead>
  );
}