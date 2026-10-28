import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPixBankLine } from "@/lib/pixBankFilter";
import { SendDivergencesDialog } from "@/components/conciliacao/SendDivergencesDialog";
import { isCashBankLine } from "@/lib/conciliacaoParsers";
import {
  Banknote, CalendarDays, ChevronDown, ChevronRight, CreditCard, Download,
  FileSpreadsheet, Landmark, Loader2, Pencil, Plus, Send, Trash2, Undo2, Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { canSendDivergences } from "@/lib/conciliationDivergences";
import { useModuleFilters } from "@/contexts/FilterContext";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";
import { DateFilterPicker } from "@/components/financeiro/DateFilterPicker";
import { ReconcilePanel, Money, fmtDay, type BoxConfig, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import { ConciliadosPairs } from "@/components/conciliacao/ConciliadosPairs";
import { JustificationsPanel } from "@/components/conciliacao/JustificationsPanel";
import { CashPaidDialog } from "@/components/conciliacao/CashPaidDialog";
import { BillingDueDialog, FrancesinhaTab } from "@/components/conciliacao/FrancesinhaTab";
import { TrxCodeDialog } from "@/components/conciliacao/TrxCodeDialog";
import { B2BBaixaTab } from "@/components/conciliacao/B2BBaixaTab";
import { DailyBankClosingTab } from "@/components/conciliacao/DailyBankClosingTab";
import { RedeAntecipacaoTab, RedeBaixaTab, RedeChargebacksTab, TarifasTab } from "@/components/conciliacao/RedeRecebimentosTabs";
import type { TrxCodeMap } from "@/hooks/useConciliacaoCartao";
import {
  useAcquirerEntries, useBankEntries, useConcMatches, useConcUploads, useImportAcquirer, useImportB2B,
  useDeleteConcUpload, useImportBankStatement, useImportOpera, useOperaEntries, useReconcile,
  useAutoReconcile, useEntriesByIds, useSetBillingPix, useConcJustifications, useSaveJustification, useSetB2B,
  useMarkCashPaid, useCashProofUrl, useMatchedCountsByUpload, useAFaturarDaily,
  useTrxCodeMapping, useUndoReconcile, useUpdateTrxCode,
  type ConcKind, type ConcMatch, type ConcSide,
} from "@/hooks/useConciliacaoCartao";

/* ------------------------------------------------------------------ */

/** Lista simples de lançamentos classificados (B2B / direto no banco / dinheiro pago). */
function ClassifiedList({ title, subtitle, rows, actionLabel, onAction, busy, exportName }: {
  title: string;
  subtitle: string;
  rows: (ReconcileRow & { info?: string })[];
  actionLabel?: string;
  onAction?: (row: ReconcileRow) => void;
  busy?: boolean;
  exportName: string;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const handleExport = () => {
    const data = rows.map((r) => ({
      Data: fmtDay(r.date), Descrição: r.title, Detalhe: r.subtitle ?? "",
      Informação: r.info ?? "", Valor: r.amount,
    }));
    data.push({ Data: "", Descrição: "TOTAL", Detalhe: "", Informação: "", Valor: total });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Lançamentos");
    XLSX.writeFile(wb, exportName);
  };
  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {subtitle} · {rows.length} lançamento(s) · Total <Money value={total} />
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport}>
          <Download className="h-3 w-3 mr-1" /> Exportar Excel
        </Button>
      </CardHeader>
      <CardContent className="p-0 max-h-[520px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nenhum lançamento aqui.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 p-3 text-[11px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground tabular-nums">{fmtDay(r.date)}</span>
                    <span className="font-medium truncate">{r.title}</span>
                  </div>
                  {r.subtitle && <p className="text-muted-foreground truncate">{r.subtitle}</p>}
                  {r.info && <p className="text-muted-foreground">{r.info}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Money value={r.amount} />
                  {actionLabel && onAction && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={busy} onClick={() => onAction(r)}>
                      <Undo2 className="h-3 w-3 mr-1" /> {actionLabel}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function ConciliacaoCartaoPage({ section = "conciliacao" }: { section?: "conciliacao" | "baixas" | "trx" }) {
  const { allowedHotels, isMaster, roles } = useAuth();
  const [sendOpen, setSendOpen] = useState(false);
  // Filtros globais de Contas a Receber (hotel + período) — o período também
  // pode ser ajustado aqui dentro, pelo seletor abaixo.
  const {
    hotelId, dateFrom, dateTo, specificDates, setDateFrom, setDateTo, setSpecificDates,
  } = useModuleFilters("financeiro");

  const setRange = (from: string, to: string) => {
    setSpecificDates([]);
    setDateFrom(from);
    setDateTo(to);
  };

  const [mainTab, setMainTab] = useState(section === "trx" ? "codigos" : section === "baixas" ? "baixa-rede" : "cartao");
  const opera = useOperaEntries(hotelId, dateFrom, dateTo, specificDates);
  const acquirer = useAcquirerEntries(hotelId, dateFrom, dateTo, specificDates);
  const bank = useBankEntries(hotelId, dateFrom, dateTo, specificDates);
  // Conciliações só são buscadas quando a aba correspondente está aberta.
  const cardMatches = useConcMatches(hotelId, "cartao", mainTab === "cartao");
  const pixMatches = useConcMatches(hotelId, "pix_extrato", mainTab === "pix");
  const cashMatches = useConcMatches(hotelId, "dinheiro", mainTab === "dinheiro");
  const aFaturar = useAFaturarDaily(hotelId, dateFrom, dateTo, specificDates, mainTab === "trx-diario");
  const justifications = useConcJustifications(hotelId);
  const loadJustifications = async () => {
    const result = await justifications.refetch();
    if (result.error) throw result.error;
    return result.data ?? [];
  };
  const saveJustification = useSaveJustification();

  const reconcile = useReconcile();
  const undo = useUndoReconcile();
  const setBillingPix = useSetBillingPix();
  const markCash = useMarkCashPaid();
  const proofUrl = useCashProofUrl();

  const [billingDueDate, setBillingDueDate] = useState<string | null>(null);
  const hotelCnpj = useQuery({
    queryKey: ["hotel-cnpj", hotelId ?? "none"], enabled: !!hotelId,
    queryFn: async () => {
      if (!hotelId) return null;
      const { data, error } = await supabase.rpc("get_hotel_financial", { _hotel_id: hotelId });
      if (error) throw error;
      return (data as unknown as { cnpj: string | null }[])?.[0]?.cnpj ?? null;
    },
  });
  const autoReconcile = useAutoReconcile();
  const trxCodes = useTrxCodeMapping();
  const updateTrx = useUpdateTrxCode();
  const [trxSearch, setTrxSearch] = useState("");
  const [trxEdit, setTrxEdit] = useState<{ code: TrxCodeMap | null; activate?: boolean } | null>(null);
  const [cashDialog, setCashDialog] = useState<ReconcileRow[] | null>(null);

  const operaRows: ReconcileRow[] = useMemo(
    () => (opera.data ?? []).map((e) => ({
      id: e.id, side: "opera" as const, date: e.business_date, amount: Number(e.amount),
      title: e.trx_desc || e.trx_code,
      subtitle: [e.room && `UH ${e.room}`, e.guest_full_name, e.receipt_no && `Rec. ${e.receipt_no}`]
        .filter(Boolean).join(" · "),
      tag: e.categoria_omie || "Sem Categoria OMIE",
      origin: e.b2b ? "B2B" : undefined,
    })),
    [opera.data],
  );
  const operaById = useMemo(() => new Map((opera.data ?? []).map((e) => [e.id, e])), [opera.data]);
  const acquirerById = useMemo(() => new Map((acquirer.data ?? []).map((e) => [e.id, e])), [acquirer.data]);
  const bankById = useMemo(() => new Map((bank.data ?? []).map((e) => [e.id, e])), [bank.data]);

  const acquirerRows: ReconcileRow[] = useMemo(
    () => (acquirer.data ?? []).map((e) => ({
      id: e.id, side: "acquirer" as const, date: e.sale_date, amount: Number(e.amount),
      title: e.categoria || e.bandeira || "—",
      subtitle: [e.modalidade, e.status, e.establishment_raw].filter(Boolean).join(" · "),
      tag: e.categoria ?? undefined,
      origin: e.source === "b2b" || e.b2b ? "B2B" : "Rede",
    })),
    [acquirer.data],
  );

  const bankRows: ReconcileRow[] = useMemo(
    () => (bank.data ?? []).map((e) => ({
      id: e.id, side: "bank" as const, date: e.line_date, amount: Number(e.amount),
      title: e.description ?? "—", subtitle: e.account_name_raw ?? undefined,
    })),
    [bank.data],
  );

  const isPix = (categoria?: string | null) => (categoria ?? "").trim().toUpperCase().includes("PIX");

  const rowById = useMemo(() => {
    const m = new Map<string, ReconcileRow>();
    for (const r of [...operaRows, ...acquirerRows, ...bankRows]) m.set(r.id, r);
    return m;
  }, [operaRows, acquirerRows, bankRows]);

  // Conciliados: a data do Opera define o período. Busca os pares fora do filtro.
  const activeMatches = mainTab === "cartao" ? cardMatches.data : mainTab === "pix" ? pixMatches.data : mainTab === "dinheiro" ? cashMatches.data : undefined;
  const missingIds = useMemo(() => {
    const out: string[] = [];
    for (const m of activeMatches ?? []) {
      const items = m.conc_match_items;
      const operaItems = items.filter((i) => i.side === "opera");
      const inPeriod = operaItems.length
        ? operaItems.some((i) => rowById.has(i.entry_id))
        : items.some((i) => rowById.has(i.entry_id));
      if (!inPeriod) continue;
      for (const i of items) if (!rowById.has(i.entry_id)) out.push(i.entry_id);
    }
    return out;
  }, [activeMatches, rowById]);
  const partners = useEntriesByIds(missingIds);
  const matchRowById = useMemo(() => {
    const m = new Map(rowById);
    const d = partners.data;
    if (!d) return m;
    for (const e of d.acq) m.set(e.id, {
      id: e.id, side: "acquirer", date: e.sale_date, amount: Number(e.amount),
      title: e.categoria || e.bandeira || "—",
      subtitle: [e.modalidade, e.status, e.establishment_raw].filter(Boolean).join(" · "),
    });
    for (const e of d.bank) m.set(e.id, {
      id: e.id, side: "bank", date: e.line_date, amount: Number(e.amount),
      title: e.description ?? "—", subtitle: e.account_name_raw ?? undefined,
    });
    for (const e of d.opera) m.set(e.id, {
      id: e.id, side: "opera", date: e.business_date, amount: Number(e.amount),
      title: e.trx_desc || e.trx_code,
      subtitle: [e.room && `UH ${e.room}`, e.guest_full_name, e.receipt_no && `Rec. ${e.receipt_no}`].filter(Boolean).join(" · "),
      tag: e.categoria_omie || "Sem Categoria OMIE",
      origin: e.b2b ? "B2B" : undefined,
    });
    return m;
  }, [rowById, partners.data]);
  const periodRowIds = useMemo(() => new Set(rowById.keys()), [rowById]);

  /* ---------------- Pendências ---------------- */

  const operaPendentesAll = operaRows.filter((r) => {
    const e = operaById.get(r.id);
    return e && !e.matched_at && !e.direct_bank && !e.cash_paid_at;
  });
  const acquirerPendentesAll = acquirerRows.filter((r) => {
    const e = acquirerById.get(r.id);
    return e && !e.matched_at;
  });
  const bankPendentes = bankRows.filter((r) => { const e = bankById.get(r.id); return e && !e.matched_at && !e.billing_pix; });

  // A Base direciona o fluxo; Categoria OMIE é somente etiqueta/chave de cruzamento.
  const operaCartao = operaPendentesAll.filter((r) => operaById.get(r.id)?.base_conciliacao === "CARTAO");
  const acquirerCartao = acquirerPendentesAll.filter((r) => !isPix(acquirerById.get(r.id)?.categoria));

  // PIX: adquirente PIX + opera PIX × extrato com "PIX" na descrição.
  const operaPix = operaPendentesAll.filter((r) => operaById.get(r.id)?.base_conciliacao === "PIX");
  const acquirerPix = acquirerPendentesAll.filter((r) => isPix(acquirerById.get(r.id)?.categoria));
  const bankPix = bankPendentes.filter((r) => {
    const e = bankById.get(r.id);
    return e && Number(e.amount) > 0 && isPixBankLine(e.description);
  });

  // Dinheiro
  const operaCash = operaPendentesAll.filter((r) => operaById.get(r.id)?.base_conciliacao === "DINHEIRO");
  // Extrato na aba Dinheiro: só depósitos em dinheiro e boletos com o CNPJ do próprio hotel.
  const bankCash = bankPendentes.filter((r) => {
    const e = bankById.get(r.id);
    return e && Number(e.amount) > 0 && isCashBankLine(e.description, e.cpf_cnpj, hotelCnpj.data);
  });

  // Classificados
  const billingPixRows = bankRows
    .filter((r) => bankById.get(r.id)?.billing_pix)
    .map((r) => ({ ...r, info: "Pagamento de Faturamento (PIX)" }));
  const markBillingPix = (rows: ReconcileRow[], value: boolean) => {
    setBillingPix.mutate(
      { ids: rows.map((r) => r.id), value },
      {
        onSuccess: () => {
          toast.success(value ? `${rows.length} lançamento(s) marcado(s) como Faturamento` : "Marcação removida");
          if (value) setBillingDueDate(rows.map((r) => r.date).filter(Boolean).sort()[0] ?? null);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };
  const cashPaidRows = operaRows
    .filter((r) => operaById.get(r.id)?.cash_paid_at)
    .map((r) => {
      const e = operaById.get(r.id);
      return { ...r, info: `Pago em ${fmtDay(e?.cash_paid_date ?? null)}${e?.cash_proof_path ? " · comprovante anexado" : ""}` };
    });

  /* ---------------- Ações ---------------- */

  const doReconcile = (kind: ConcKind) => (left: ReconcileRow[], right: ReconcileRow[]) => {
    if (!hotelId) return;
    reconcile.mutate(
      {
        hotelId, kind,
        left: left.map((r) => ({ side: r.side, id: r.id, amount: r.amount })),
        right: right.map((r) => ({ side: r.side, id: r.id, amount: r.amount })),
      },
      {
        onSuccess: () => toast.success("Lançamentos conciliados"),
        onError: (err: Error) => toast.error(err.message),
      },
    );
  };

  const undoMany = (list: ConcMatch[]) => {
    if (!list.length) return;
    let done = 0;
    for (const m of list) {
      undo.mutate(m, {
        onSuccess: () => {
          done++;
          if (done === list.length) toast.success(`${done} conciliação(ões) desfeita(s)`);
        },
        onError: (e: Error) => toast.error(e.message),
      });
    }
  };

  const saveNote = (kind: ConcKind) => (row: ReconcileRow, note: string) => {
    if (!hotelId) return;
    saveJustification.mutate(
      { hotelId, side: row.side as ConcSide, entryId: row.id, kind, note },
      { onSuccess: () => toast.success("Justificativa salva"), onError: (e: Error) => toast.error(e.message) },
    );
  };

  /* ---------------- Total diário por TRX Code ---------------- */

  const trxDaily = useMemo(() => {
    const map = new Map<string, { date: string; code: string; desc: string; total: number; count: number }>();
    for (const e of opera.data ?? []) {
      const key = `${e.business_date ?? ""}|${e.trx_code}`;
      const cur = map.get(key) ?? {
        date: e.business_date ?? "", code: e.trx_code, desc: e.trx_desc ?? "", total: 0, count: 0,
      };
      cur.total += Number(e.amount);
      cur.count += 1;
      map.set(key, cur);
    }
    // 9003 — A Faturar: total lançado em Faturamento no dia (não vem dos arquivos importados).
    for (const f of aFaturar.data ?? []) {
      map.set(`${f.day}|9003`, { date: f.day, code: "9003", desc: "A Faturar", total: f.total, count: f.n });
    }
    return [...map.values()].sort((a, b) => (a.date === b.date ? a.code.localeCompare(b.code) : a.date.localeCompare(b.date)));
  }, [opera.data, aFaturar.data]);

  /** Visão inicial: total do dia somando todos os TRX Codes. */
  const trxDays = useMemo(() => {
    const map = new Map<string, { date: string; total: number; count: number; codes: number }>();
    for (const t of trxDaily) {
      const cur = map.get(t.date) ?? { date: t.date, total: 0, count: 0, codes: 0 };
      cur.total += t.total;
      cur.count += t.count;
      cur.codes += 1;
      map.set(t.date, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [trxDaily]);
  const [trxOpenDay, setTrxOpenDay] = useState<string | null>(null);


  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? "";
  const needsHotel = !hotelId;

  const trxVisible = (trxCodes.data ?? []).filter((c) => {
    const t = trxSearch.trim().toLowerCase();
    if (!t) return true;
    return [c.trx_code, c.descricao, c.categoria, c.categoria_omie, c.conta_corrente_omie].filter(Boolean).some((v) => String(v).toLowerCase().includes(t));
  });

  const NoHotel = (
    <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      Selecione um hotel no filtro do topo da página para começar.
    </CardContent></Card>
  );

  const cardBoxes: BoxConfig[] = [
    {
      key: "acq-card", title: "Adquirente", subtitle: "Vendas de cartão — Rede e B2B",
      position: "left", rows: acquirerCartao,
    },
    {
      key: "opera-card", title: "Front Caixa", subtitle: "Opera — transações de cartão",
      position: "right", rows: operaCartao,
    },
  ];

  const pixBoxes: BoxConfig[] = [
    { key: "acq-pix", title: "Adquirente (PIX)", subtitle: "Operadora — vendas sem bandeira", position: "left", rows: acquirerPix },
    {
      key: "opera-pix", title: "Front Caixa (PIX)", subtitle: "Opera — transações PIX",
      position: "left", rows: operaPix,
    },
    {
      key: "bank-pix", title: "Extrato Bancário", subtitle: 'PIX / recebidos / recebimentos', position: "right", rows: bankPix,
      actions: [{
        label: "Marcar como Faturamento",
        icon: <FileSpreadsheet className="h-3 w-3 mr-1" />,
        disabled: setBillingPix.isPending,
        onRun: (rows) => markBillingPix(rows, true),
      }],
    },
  ];

  const cashBoxes: BoxConfig[] = [
    {
      key: "opera-cash", title: "Front Caixa (Dinheiro)", subtitle: "Opera — categoria DINHEIRO",
      position: "left", rows: operaCash,
      actions: [{
        label: "Marcar como pago",
        icon: <Banknote className="h-3 w-3 mr-1" />,
        disabled: markCash.isPending,
        onRun: (rows) => setCashDialog(rows),
      }],
    },
    { key: "bank-cash", title: "Extrato Bancário", subtitle: "Depósitos / créditos", position: "right", rows: bankCash },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Opera × Operadora × Extrato bancário — conciliação manual pelo financeiro.
          {hotelId ? <> Hotel: <span className="font-medium text-foreground">{hotelName}</span>.</> : null}
        </p>
        <DateFilterPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          specificDates={specificDates}
          onChangeRange={setRange}
          onChangeSpecific={setSpecificDates}
        />
      </div>

      {canSendDivergences(isMaster, roles) && ["cartao", "pix", "dinheiro"].includes(mainTab) && (
        <div className="flex justify-end">
          <Button variant="outline" disabled={!hotelId} onClick={() => setSendOpen(true)}><Send className="mr-2 h-4 w-4" />Enviar divergências agora</Button>
        </div>
      )}
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {section === "conciliacao" && <><TabsTrigger value="cartao">Cartão</TabsTrigger><TabsTrigger value="pix">PIX</TabsTrigger><TabsTrigger value="dinheiro">Dinheiro</TabsTrigger></>}
          {section === "baixas" && <><TabsTrigger value="baixa-rede">Rede</TabsTrigger><TabsTrigger value="baixa-b2b">B2B</TabsTrigger><TabsTrigger value="francesinha">Francesinha</TabsTrigger><TabsTrigger value="chargebacks">Chargebacks</TabsTrigger><TabsTrigger value="antecipacao">Antecipação</TabsTrigger><TabsTrigger value="tarifas">Tarifas</TabsTrigger><TabsTrigger value="fechamento-diario">Fechamento diário</TabsTrigger></>}
          {section === "trx" && <><TabsTrigger value="codigos">Códigos TRX</TabsTrigger><TabsTrigger value="trx-diario">Total diário por TRX</TabsTrigger></>}
        </TabsList>
        <TabsContent value="fechamento-diario">{hotelId ? <DailyBankClosingTab hotelId={hotelId} dateFrom={dateFrom} dateTo={dateTo} dates={specificDates} /> : NoHotel}</TabsContent>
        <TabsContent value="baixa-b2b">{hotelId && <B2BBaixaTab hotelId={hotelId} />}</TabsContent>
        <TabsContent value="baixa-rede">{hotelId && <RedeBaixaTab hotelId={hotelId} />}</TabsContent>
        <TabsContent value="chargebacks">{hotelId && <RedeChargebacksTab hotelId={hotelId} />}</TabsContent>
        <TabsContent value="antecipacao">{hotelId && <RedeAntecipacaoTab hotelId={hotelId} />}</TabsContent>
        <TabsContent value="tarifas">{hotelId && <TarifasTab hotelId={hotelId} />}</TabsContent>

        {/* ---------------- Cartão ---------------- */}
        <TabsContent value="cartao" className="mt-4">
          {needsHotel ? NoHotel : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="justificativa" className="text-[11px]">Justificativa</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">Cartões Conciliados</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  boxes={cardBoxes}
                  onReconcile={doReconcile("cartao")}
                  isReconciling={reconcile.isPending}
                  exportName={`conciliacao-cartao-${hotelId}.xlsx`}
                  kind="cartao" loadJustifications={loadJustifications}
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={[...acquirerCartao, ...operaCartao]}
                  justifications={justifications.data ?? []}
                  kind="cartao"
                  dateFrom={dateFrom} dateTo={dateTo} onChangeRange={setRange}
                  onSave={saveNote("cartao")}
                  saving={saveJustification.isPending}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosPairs
                  matches={cardMatches.data ?? []}
                  rowById={matchRowById}
                  periodIds={periodRowIds}
                  leftSides={["acquirer"]}
                  title="Cartões conciliados — Adquirente × Front Caixa"
                  exportName={`cartoes-conciliados-${hotelId}.xlsx`}
                  onUndoMany={undoMany}
                  undoing={undo.isPending}
                />
              </TabsContent>

            </Tabs>
          )}
        </TabsContent>

        {/* ---------------- PIX ---------------- */}
        <TabsContent value="pix" className="mt-4">
          {needsHotel ? NoHotel : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="justificativa" className="text-[11px]">Justificativa</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">PIX Conciliados</TabsTrigger>
                <TabsTrigger value="faturamento" className="text-[11px]">Faturamento (PIX)</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  boxes={pixBoxes}
                  onReconcile={doReconcile("pix_extrato")}
                  isReconciling={reconcile.isPending}
                  exportName={`conciliacao-pix-${hotelId}.xlsx`}
                  kind="pix_extrato" loadJustifications={loadJustifications}
                  compareMode="equal-boxes"
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={[...acquirerPix, ...operaPix, ...bankPix]}
                  justifications={justifications.data ?? []}
                  kind="pix_extrato"
                  dateFrom={dateFrom} dateTo={dateTo} onChangeRange={setRange}
                  onSave={saveNote("pix_extrato")}
                  saving={saveJustification.isPending}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosPairs
                  matches={pixMatches.data ?? []}
                  rowById={matchRowById}
                  periodIds={periodRowIds}
                  leftSides={["opera"]}
                  infoSides={["acquirer"]}
                  columns={[
                    { label: "Adquirente", sides: ["acquirer"] },
                    { label: "Opera", sides: ["opera"] },
                    { label: "Banco", sides: ["bank"] },
                  ]}
                  title="PIX conciliados — Adquirente · Opera · Banco"
                  exportName={`pix-conciliados-${hotelId}.xlsx`}
                  onUndoMany={undoMany}
                  undoing={undo.isPending}
                />
              </TabsContent>
              <TabsContent value="faturamento" className="mt-4">
                <ClassifiedList
                  title="PIX do extrato marcados como Faturamento"
                  subtitle="Lançamentos do extrato retirados das pendências (não excluídos)"
                  rows={billingPixRows}
                  actionLabel="Desmarcar"
                  busy={setBillingPix.isPending}
                  onAction={(r) => markBillingPix([r], false)}
                  exportName={`pix-faturamento-${hotelId}.xlsx`}
                />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* ---------------- Dinheiro ---------------- */}
        <TabsContent value="dinheiro" className="mt-4">
          {needsHotel ? NoHotel : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="justificativa" className="text-[11px]">Justificativa</TabsTrigger>
                <TabsTrigger value="pagos" className="text-[11px]">Pagos</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">Dinheiro Conciliado</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  boxes={cashBoxes}
                  onReconcile={doReconcile("dinheiro")}
                  isReconciling={reconcile.isPending}
                  exportName={`conciliacao-dinheiro-${hotelId}.xlsx`}
                  kind="dinheiro" loadJustifications={loadJustifications}
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={operaCash}
                  justifications={justifications.data ?? []}
                  kind="dinheiro"
                  dateFrom={dateFrom} dateTo={dateTo} onChangeRange={setRange}
                  onSave={saveNote("dinheiro")}
                  saving={saveJustification.isPending}
                />
              </TabsContent>
              <TabsContent value="pagos" className="mt-4">
                <ClassifiedList
                  title="Dinheiro marcado como pago"
                  subtitle="Com data do pagamento e comprovante"
                  rows={cashPaidRows}
                  actionLabel="Ver comprovante"
                  busy={proofUrl.isPending}
                  onAction={(r) => {
                    const path = operaById.get(r.id)?.cash_proof_path;
                    if (!path) { toast.info("Sem comprovante anexado."); return; }
                    proofUrl.mutate(path, {
                      onSuccess: (url) => window.open(url, "_blank", "noopener"),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                  exportName={`dinheiro-pago-${hotelId}.xlsx`}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosPairs
                  matches={cashMatches.data ?? []}
                  rowById={matchRowById}
                  periodIds={periodRowIds}
                  leftSides={["opera"]}
                  title="Dinheiro conciliado — Opera × Extrato Bancário"
                  exportName={`dinheiro-conciliado-${hotelId}.xlsx`}
                  onUndoMany={undoMany}
                  undoing={undo.isPending}
                />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* ---------------- Total diário por TRX ---------------- */}
        <TabsContent value="trx-diario" className="mt-4">
          {needsHotel ? NoHotel : (
            <Card>
              <CardHeader className="pb-3 flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">Total diário por TRX Code</CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Total do dia somando todos os TRX Codes — clique num dia para ver a quebra por código
                    (respeita o período selecionado).
                  </p>
                </div>
                <Button
                  variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => {
                    const data = trxDaily.map((t) => ({
                      Data: fmtDay(t.date || null), Código: t.code, Descrição: t.desc,
                      Lançamentos: t.count, Total: t.total,
                    }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Total diário TRX");
                    XLSX.writeFile(wb, `total-diario-trx-${hotelId}.xlsx`);
                  }}
                >
                  <Download className="h-3 w-3 mr-1" /> Exportar Excel
                </Button>
              </CardHeader>
              <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">TRX Codes</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead className="text-right">Total do dia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trxDays.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                        Nenhum lançamento no período.
                      </TableCell></TableRow>
                    )}
                    {trxDays.map((d) => {
                      const open = trxOpenDay === d.date;
                      return (
                        <Fragment key={d.date}>
                          <TableRow
                            className="text-[11px] cursor-pointer hover:bg-muted/50"
                            onClick={() => setTrxOpenDay(open ? null : d.date)}
                          >
                            <TableCell className="tabular-nums font-medium">
                              <span className="inline-flex items-center gap-1">
                                {open
                                  ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                {fmtDay(d.date || null)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">{d.codes}</TableCell>
                            <TableCell className="text-right">{d.count}</TableCell>
                            <TableCell className="text-right font-medium"><Money value={d.total} /></TableCell>
                          </TableRow>
                          {open &&
                            trxDaily
                              .filter((t) => t.date === d.date)
                              .map((t) => (
                                <TableRow key={`${t.date}-${t.code}`} className="text-[11px] bg-muted/30">
                                  <TableCell className="pl-8 font-mono">{t.code}</TableCell>
                                  <TableCell colSpan={1} className="max-w-[280px] truncate text-muted-foreground">
                                    {t.desc || "—"}
                                  </TableCell>
                                  <TableCell className="text-right">{t.count}</TableCell>
                                  <TableCell className="text-right"><Money value={t.total} /></TableCell>
                                </TableRow>
                              ))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- Códigos TRX ---------------- */}
        <TabsContent value="francesinha" className="mt-4">
          {hotelId ? <FrancesinhaTab hotelId={hotelId} /> : NoHotel}
        </TabsContent>
        <TabsContent value="codigos" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Códigos de transação (Opera)</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Somente códigos ativos entram na conciliação — ativar exige categoria definida.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input value={trxSearch} onChange={(e) => setTrxSearch(e.target.value)}
                  placeholder="Buscar código ou base…" className="h-8 w-[240px] text-xs" />
                <Button size="sm" className="h-8 text-xs" onClick={() => setTrxEdit({ code: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Novo código
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 max-h-[560px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Base de Conciliação</TableHead>
                    <TableHead>Categoria OMIE</TableHead>
                    <TableHead>Conta Corrente OMIE</TableHead>
                    <TableHead className="text-right">Ativo</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trxVisible.map((c) => (
                    <TableRow key={c.id} className="text-[11px]">
                      <TableCell className="font-mono">{c.trx_code}</TableCell>
                      <TableCell>{c.descricao ?? "—"}</TableCell>
                      <TableCell>
                        {c.categoria ? <Badge variant="outline" className="text-[10px]">{c.categoria}</Badge> : "—"}
                      </TableCell>
                      <TableCell>{c.categoria_omie ?? "—"}</TableCell>
                      <TableCell>{c.conta_corrente_omie ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={c.ativo}
                          onCheckedChange={(v) => {
                            if (v && !c.categoria) {
                              setTrxEdit({ code: c, activate: true });
                              return;
                            }
                            updateTrx.mutate({ id: c.id, ativo: v }, {
                              onError: (e: Error) => toast.error(e.message),
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${c.trx_code}`}
                          onClick={() => setTrxEdit({ code: c })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {(opera.isLoading || acquirer.isLoading || bank.isLoading) && hotelId && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando lançamentos…
        </p>
      )}

      {hotelId && <SendDivergencesDialog key={hotelId} hotelId={hotelId} open={sendOpen} onOpenChange={setSendOpen} />}
      {/* Dinheiro — marcar como pago */}
      {hotelId && <BillingDueDialog hotelId={hotelId} date={billingDueDate} onClose={() => setBillingDueDate(null)} />}
      <CashPaidDialog
        open={!!cashDialog}
        onOpenChange={(v) => !v && setCashDialog(null)}
        count={cashDialog?.length ?? 0}
        total={(cashDialog ?? []).reduce((s, r) => s + r.amount, 0)}
        saving={markCash.isPending}
        onConfirm={(paidDate, proof) => {
          if (!hotelId || !cashDialog) return;
          markCash.mutate(
            { ids: cashDialog.map((r) => r.id), hotelId, paidDate, proof },
            {
              onSuccess: () => { toast.success("Lançamentos marcados como pagos"); setCashDialog(null); },
              onError: (e: Error) => toast.error(e.message),
            },
          );
        }}
      />

      <TrxCodeDialog open={!!trxEdit} onOpenChange={(v) => !v && setTrxEdit(null)}
        code={trxEdit?.code ?? null} activate={trxEdit?.activate} />
    </div>
  );
}
