import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { useAllHotels } from "@/hooks/useHotelAssets";
import {
  useToInvoiceEntries,
  useOpenFolioEntries,
  useLatestArUpload,
  useUploadArReport,
  useClientContracts,
  useUpsertContract,
  useDeleteContract,
  useOpenFolioNotes,
  useUpsertOpenFolioNote,
  findContractTerm,
  addDays,
  type ToInvoiceEntry,
  type OpenFolioEntry,
  type ClientContract,
} from "@/hooks/useAccountsReceivable";
import { Upload, Loader2, FileSpreadsheet, AlertTriangle, ArrowLeft, Plus, Trash2, MessageSquare, FileDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";

function brl(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
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
      "Data prevista de pagamento": fmt(expected),
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

export default function ContasReceberPage() {
  const { hasRole, isMaster, userHotels } = useAuth();
  const isManager = isMaster || hasRole("financeiro");
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
          <TabsTrigger value="to_invoice">A Faturar</TabsTrigger>
          <TabsTrigger value="open_folio">Open Folio</TabsTrigger>
        </TabsList>
        <TabsContent value="to_invoice" className="mt-5">
          <ToInvoiceSection
            isManager={isManager}
            seesAllHotels={seesAllHotels}
            restrictedHotelIds={restrictedHotelIds}
            isGgOnly={isGgOnly}
          />
        </TabsContent>
        <TabsContent value="open_folio" className="mt-5">
          <OpenFolioSection
            isManager={isManager}
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
  seesAllHotels,
  restrictedHotelIds,
  isGgOnly,
}: {
  isManager: boolean;
  seesAllHotels: boolean;
  restrictedHotelIds: string[] | null;
  isGgOnly: boolean;
}) {
  const { data: allHotels = [] } = useAllHotels();
  // Filtro global do header (Hotel) é a única fonte de verdade.
  const { hotelId: globalHotelId } = useFilters();
  const hotelId = globalHotelId ?? "";
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const [drillDay, setDrillDay] = useState<string | null>(null);
  const [contractsOpen, setContractsOpen] = useState(false);

  // Reset drill quando hotel muda
  useEffect(() => {
    setDrillMonth(null);
    setDrillDay(null);
  }, [hotelId]);

  const { data: entries = [], isLoading } = useToInvoiceEntries({
    hotelId: hotelId || undefined,
  });
  const { data: lastUpload } = useLatestArUpload("to_invoice");
  const { data: contracts } = useClientContracts(hotelId || null);

  const hotelName = (id: string | null) =>
    id ? allHotels.find((h) => h.id === id)?.name ?? id : "—";

  // Para o ranking consolidado, restringe entradas aos hotéis visíveis quando não master
  const visibleEntries = useMemo(() => {
    if (seesAllHotels) return entries;
    const allowed = new Set(restrictedHotelIds ?? []);
    return entries.filter((e) => e.hotel_id && allowed.has(e.hotel_id));
  }, [entries, seesAllHotels, restrictedHotelIds]);

  return (
    <div className="space-y-5">
      <UploadCard kind="to_invoice" lastUpload={lastUpload} isManager={isManager} />

      <Card className="p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground">Hotel</p>
            <p className="text-sm font-semibold">
              {hotelId ? hotelName(hotelId) : "Todos os hotéis (consolidado)"}
            </p>
          </div>
          {hotelId && (
            <Button variant="outline" size="sm" onClick={() => setContractsOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Contratos do hotel
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : visibleEntries.length === 0 ? (
          <EmptyState text="Nenhum lançamento a faturar para os filtros selecionados." />
        ) : !hotelId ? (
          <ConsolidatedRanking entries={visibleEntries} hotelName={hotelName} />
        ) : drillDay ? (
          <DayBreakdown
            entries={visibleEntries.filter((e) => e.transaction_date === drillDay)}
            day={drillDay}
            contracts={contracts}
            onBack={() => setDrillDay(null)}
          />
        ) : drillMonth ? (
          <MonthBreakdown
            entries={visibleEntries.filter((e) => e.transaction_date && ymKey(e.transaction_date) === drillMonth)}
            month={drillMonth}
            onPickDay={setDrillDay}
            onBack={() => setDrillMonth(null)}
          />
        ) : (
          <MonthlyOverview entries={visibleEntries} onPickMonth={setDrillMonth} />
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
            <p className="text-xl font-semibold mt-1">{brl(total)}</p>
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
                  <TableCell className="text-right font-semibold">{brl(total)}</TableCell>
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
}: {
  entries: ToInvoiceEntry[];
  day: string;
  contracts: ClientContract[] | undefined;
  onBack: () => void;
}) {
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const term = findContractTerm(contracts, e.account_number, e.account_name);
              const due = term != null && e.transaction_date ? addDays(e.transaction_date, term) : null;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{e.account_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{e.account_number ?? ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(e.amount)}</TableCell>
                  <TableCell className="text-right text-xs">
                    {term != null ? `${term} dias` : <span className="text-muted-foreground">sem contrato</span>}
                  </TableCell>
                  <TableCell className="text-xs">{due ? formatDay(due) : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
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
        <span className="text-xs text-muted-foreground">Total: <strong>{brl(grand)}</strong></span>
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
                {brl(r.total)}
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
  seesAllHotels,
  restrictedHotelIds,
  isGgOnly,
}: {
  isManager: boolean;
  seesAllHotels: boolean;
  restrictedHotelIds: string[] | null;
  isGgOnly: boolean;
}) {
  const { data: hotels = [] } = useAllHotels();
  const { data: entries = [], isLoading } = useOpenFolioEntries();
  const { data: lastUpload } = useLatestArUpload("open_folio");
  // Filtro global do header (Hotel) é a única fonte de verdade.
  const { hotelId: globalHotelId, setHotelId } = useFilters();
  const selectedHotel = globalHotelId;
  const [agingFilter, setAgingFilter] = useState<"all" | "fresh" | "mid" | "old">("all");
  const allowedSet = useMemo(
    () => (seesAllHotels ? null : new Set(restrictedHotelIds ?? [])),
    [seesAllHotels, restrictedHotelIds],
  );
  const visibleEntries = useMemo(
    () => (allowedSet ? entries.filter((e) => e.hotel_id && allowedSet.has(e.hotel_id)) : entries),
    [entries, allowedSet],
  );

  const summaries = useMemo(() => {
    const map = new Map<string, { count: number; total: number; daysSum: number; daysCount: number }>();
    for (const e of visibleEntries) {
      if (!e.hotel_id) continue;
      const cur = map.get(e.hotel_id) ?? { count: 0, total: 0, daysSum: 0, daysCount: 0 };
      cur.count++;
      cur.total += Number(e.balance ?? 0);
      if (e.days_open != null) {
        cur.daysSum += e.days_open;
        cur.daysCount++;
      }
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
      }))
      .sort((a, b) => b.total - a.total);
  }, [visibleEntries, hotels]);

  const filteredEntries = useMemo(() => {
    if (!selectedHotel) return [];
    return visibleEntries
      .filter((e) => e.hotel_id === selectedHotel)
      .filter((e) => {
        if (agingFilter === "all") return true;
        const d = e.days_open ?? 0;
        if (agingFilter === "fresh") return d <= 30;
        if (agingFilter === "mid") return d > 30 && d <= 90;
        return d > 90;
      })
      .sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
  }, [visibleEntries, selectedHotel, agingFilter]);

  return (
    <div className="space-y-5">
      <UploadCard kind="open_folio" lastUpload={lastUpload} isManager={isManager} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : selectedHotel ? (
        <HotelOpenFolioDetail
          hotelId={selectedHotel}
          hotelName={hotels.find((h) => h.id === selectedHotel)?.name ?? selectedHotel}
          entries={filteredEntries}
          agingFilter={agingFilter}
          setAgingFilter={setAgingFilter}
          onBack={() => setHotelId(null)}
          hideBack={isGgOnly}
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
                  <button
                    key={s.id}
                    onClick={() => setHotelId(s.id)}
                    className="w-full text-left p-4 rounded-lg border hover:border-accent hover:shadow-soft transition-all flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.count} folio(s) em aberto</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">{brl(s.total)}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${tone}`}>
                        média {s.avgDays}d
                      </span>
                    </div>
                  </button>
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
  onBack,
  hideBack,
}: {
  hotelId: string;
  hotelName: string;
  entries: OpenFolioEntry[];
  agingFilter: "all" | "fresh" | "mid" | "old";
  setAgingFilter: (v: "all" | "fresh" | "mid" | "old") => void;
  onBack: () => void;
  hideBack?: boolean;
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
        </div>
        <Select value={agingFilter} onValueChange={(v) => setAgingFilter(v as typeof agingFilter)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="fresh">Até 30 dias</SelectItem>
            <SelectItem value="mid">31 a 90 dias</SelectItem>
            <SelectItem value="old">Acima de 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hóspede</TableHead>
              <TableHead>Confirmação</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead className="text-right">Em aberto</TableHead>
              <TableHead>Previsto pagto</TableHead>
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
                    <TableCell className="text-sm">{fullName(e)}</TableCell>
                    <TableCell className="font-mono text-xs">{cn || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(e.balance)}</TableCell>
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
            {entry && <>{fullName(entry)} · {entry.confirmation_number} · {brl(entry.balance)}</>}
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
            <Label className="text-xs">Data prevista de pagamento (opcional)</Label>
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
                        <Button variant="ghost" size="sm" onClick={async () => {
                          if (!confirm("Remover contrato?")) return;
                          try {
                            await del.mutateAsync({ id: c.id, hotel_id: hotelId });
                            toast.success("Contrato removido");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Erro");
                          }
                        }}>
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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const res = await upload.mutateAsync({ file: f, kind });
      const unmapped = (res?.unmapped_properties ?? []) as string[];
      if (unmapped.length) {
        toast.warning(`${res.entries} linha(s) processadas. ${unmapped.length} hotel(éis) não mapeado(s) — configure em Hotéis.`, { duration: 8000 });
      } else {
        toast.success(`${res.entries} linha(s) processadas`);
      }
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
            {kind === "to_invoice" ? "Importar relatório A Faturar" : "Importar relatório Open Folio"}
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