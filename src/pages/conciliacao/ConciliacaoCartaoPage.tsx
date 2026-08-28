import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Banknote, CalendarDays, CreditCard, Download, FileSpreadsheet, Landmark,
  Loader2, Trash2, Undo2, Upload, Users,
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
import { useModuleFilters } from "@/contexts/FilterContext";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";
import { DateFilterPicker } from "@/components/financeiro/DateFilterPicker";
import { ReconcilePanel, Money, fmtDay, type BoxConfig, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import { ConciliadosPairs } from "@/components/conciliacao/ConciliadosPairs";
import { JustificationsPanel } from "@/components/conciliacao/JustificationsPanel";
import { CashPaidDialog } from "@/components/conciliacao/CashPaidDialog";
import {
  useAcquirerEntries, useBankEntries, useConcMatches, useConcUploads, useImportAcquirer,
  useDeleteConcUpload, useImportBankStatement, useImportOpera, useOperaEntries, useReconcile,
  useAutoReconcile, useConcJustifications, useSaveJustification, useSetB2B, useSetDirectBankBulk,
  useMarkCashPaid, useCashProofUrl, useMatchedCountsByUpload,
  useTrxCodeMapping, useUndoReconcile, useUpdateTrxCode,
  type ConcKind, type ConcMatch, type ConcSide,
} from "@/hooks/useConciliacaoCartao";

/* ------------------------------------------------------------------ */

function DropZone({ label, hint, accept, onFile, busy }: {
  label: string; hint: string; accept: Record<string, string[]>;
  onFile: (f: File) => void; busy: boolean;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept, maxFiles: 1, disabled: busy,
    onDrop: (files) => files[0] && onFile(files[0]),
  });
  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
        isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
      } ${busy ? "opacity-60 pointer-events-none" : ""}`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6 opacity-40" />}
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px]">{hint}</p>
      </div>
    </div>
  );
}

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

export default function ConciliacaoCartaoPage() {
  const { allowedHotels } = useAuth();
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

  const opera = useOperaEntries(hotelId, dateFrom, dateTo, specificDates);
  const acquirer = useAcquirerEntries(hotelId, dateFrom, dateTo, specificDates);
  const bank = useBankEntries(hotelId, dateFrom, dateTo, specificDates);
  const cardMatches = useConcMatches(hotelId, "cartao");
  const pixMatches = useConcMatches(hotelId, "pix_extrato");
  const cashMatches = useConcMatches(hotelId, "dinheiro");
  const justifications = useConcJustifications(hotelId);
  const saveJustification = useSaveJustification();

  const reconcile = useReconcile();
  const undo = useUndoReconcile();
  const setDirectBulk = useSetDirectBankBulk();
  const setB2B = useSetB2B();
  const markCash = useMarkCashPaid();
  const proofUrl = useCashProofUrl();

  const importOpera = useImportOpera();
  const importAcquirer = useImportAcquirer();
  const importBank = useImportBankStatement();
  const autoReconcile = useAutoReconcile();
  const uploads = useConcUploads();
  const matchedByUpload = useMatchedCountsByUpload();
  const deleteUpload = useDeleteConcUpload();
  const trxCodes = useTrxCodeMapping();
  const updateTrx = useUpdateTrxCode();
  const [trxSearch, setTrxSearch] = useState("");
  const [trxActivate, setTrxActivate] = useState<{ id: string; code: string; categoria: string } | null>(null);
  const [cashDialog, setCashDialog] = useState<ReconcileRow[] | null>(null);

  const uploadHotelLabel = (u: Record<string, unknown>): string => {
    const direct = allowedHotels.find((h) => h.id === u.hotel_id)?.name;
    if (direct) return direct;
    const meta = (u.metadata ?? {}) as { hotel_ids?: string[] };
    const names = (meta.hotel_ids ?? [])
      .map((id) => allowedHotels.find((h) => h.id === id)?.name)
      .filter(Boolean) as string[];
    if (names.length === 0) return "—";
    return names.length <= 2 ? names.join(", ") : `${names.length} hotéis`;
  };

  const operaRows: ReconcileRow[] = useMemo(
    () => (opera.data ?? []).map((e) => ({
      id: e.id, side: "opera" as const, date: e.business_date, amount: Number(e.amount),
      title: e.trx_desc || e.trx_code,
      subtitle: [e.room && `UH ${e.room}`, e.guest_full_name, e.receipt_no && `Rec. ${e.receipt_no}`]
        .filter(Boolean).join(" · "),
      tag: e.categoria ?? undefined,
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

  const isPix = (categoria?: string | null) => (categoria ?? "").includes("PIX");
  const isCash = (categoria?: string | null) => (categoria ?? "").includes("DINHEIRO");

  const rowById = useMemo(() => {
    const m = new Map<string, ReconcileRow>();
    for (const r of [...operaRows, ...acquirerRows, ...bankRows]) m.set(r.id, r);
    return m;
  }, [operaRows, acquirerRows, bankRows]);

  /* ---------------- Pendências ---------------- */

  const operaPendentesAll = operaRows.filter((r) => {
    const e = operaById.get(r.id);
    return e && !e.matched_at && !e.direct_bank && !e.b2b && !e.cash_paid_at;
  });
  const acquirerPendentesAll = acquirerRows.filter((r) => {
    const e = acquirerById.get(r.id);
    return e && !e.matched_at && !e.b2b;
  });
  const bankPendentes = bankRows.filter((r) => !bankById.get(r.id)?.matched_at);

  // Cartão: sem PIX e sem dinheiro (cada um tem sua tela).
  const operaCartao = operaPendentesAll.filter((r) => {
    const c = operaById.get(r.id)?.categoria;
    return !isPix(c) && !isCash(c);
  });
  const acquirerCartao = acquirerPendentesAll.filter((r) => !isPix(acquirerById.get(r.id)?.categoria));

  // PIX: adquirente PIX + opera PIX × extrato com "PIX" na descrição.
  const operaPix = operaPendentesAll.filter((r) => isPix(operaById.get(r.id)?.categoria));
  const acquirerPix = acquirerPendentesAll.filter((r) => isPix(acquirerById.get(r.id)?.categoria));
  const bankPix = bankPendentes.filter((r) => {
    const e = bankById.get(r.id);
    return e && Number(e.amount) > 0 && (e.description ?? "").toUpperCase().includes("PIX");
  });

  // Dinheiro
  const operaCash = operaPendentesAll.filter((r) => isCash(operaById.get(r.id)?.categoria));
  const bankCash = bankPendentes.filter((r) => Number(bankById.get(r.id)?.amount ?? 0) > 0);

  // Classificados
  const b2bRows = [
    ...operaRows.filter((r) => operaById.get(r.id)?.b2b).map((r) => ({ ...r, info: "Opera · B2B" })),
    ...acquirerRows.filter((r) => acquirerById.get(r.id)?.b2b).map((r) => ({ ...r, info: "Adquirente · B2B" })),
  ];
  const directBankRows = operaRows
    .filter((r) => operaById.get(r.id)?.direct_bank)
    .map((r) => ({ ...r, info: "Recebido direto no banco" }));
  const cashPaidRows = operaRows
    .filter((r) => operaById.get(r.id)?.cash_paid_at)
    .map((r) => {
      const e = operaById.get(r.id)!;
      return { ...r, info: `Pago em ${fmtDay(e.cash_paid_date)}${e.cash_proof_path ? " · comprovante anexado" : ""}` };
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

  const classifyB2B = (rows: ReconcileRow[], side: "opera" | "acquirer", value: boolean) => {
    setB2B.mutate(
      { ids: rows.map((r) => r.id), side, value },
      {
        onSuccess: () => toast.success(value ? `${rows.length} lançamento(s) classificado(s) como B2B` : "Classificação B2B removida"),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const markDirectBank = (rows: ReconcileRow[], value: boolean) => {
    setDirectBulk.mutate(
      { ids: rows.map((r) => r.id), value },
      {
        onSuccess: () => toast.success(value ? `${rows.length} lançamento(s) marcado(s) como direto no banco` : "Marcação removida"),
        onError: (e: Error) => toast.error(e.message),
      },
    );
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
    return [...map.values()].sort((a, b) => (a.date === b.date ? a.code.localeCompare(b.code) : a.date.localeCompare(b.date)));
  }, [opera.data]);

  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? "";
  const needsHotel = !hotelId;

  const trxVisible = (trxCodes.data ?? []).filter((c) => {
    const t = trxSearch.trim().toLowerCase();
    if (!t) return true;
    return [c.trx_code, c.descricao, c.categoria].filter(Boolean).some((v) => String(v).toLowerCase().includes(t));
  });

  const NoHotel = (
    <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      Selecione um hotel no filtro do topo da página para começar.
    </CardContent></Card>
  );

  const cardBoxes: BoxConfig[] = [
    {
      key: "acq-card", title: "Adquirente", subtitle: "Operadora (Rede) — vendas de cartão",
      position: "left", rows: acquirerCartao,
      actions: [{
        label: "Classificar como B2B",
        icon: <Users className="h-3 w-3 mr-1" />,
        disabled: setB2B.isPending,
        onRun: (rows) => classifyB2B(rows, "acquirer", true),
      }],
    },
    {
      key: "opera-card", title: "Front Caixa", subtitle: "Opera — transações de cartão",
      position: "right", rows: operaCartao,
      actions: [{
        label: "Classificar como B2B",
        icon: <Users className="h-3 w-3 mr-1" />,
        disabled: setB2B.isPending,
        onRun: (rows) => classifyB2B(rows, "opera", true),
      }],
    },
  ];

  const pixBoxes: BoxConfig[] = [
    { key: "acq-pix", title: "Adquirente (PIX)", subtitle: "Operadora — vendas sem bandeira", position: "left", rows: acquirerPix },
    {
      key: "opera-pix", title: "Front Caixa (PIX)", subtitle: "Opera — transações PIX",
      position: "left", rows: operaPix,
      actions: [{
        label: "Direto no banco",
        icon: <Landmark className="h-3 w-3 mr-1" />,
        disabled: setDirectBulk.isPending,
        onRun: (rows) => markDirectBank(rows, true),
      }],
    },
    { key: "bank-pix", title: "Extrato Bancário", subtitle: 'Lançamentos com "PIX" na descrição', position: "right", rows: bankPix },
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

      <Tabs defaultValue="cartao">
        <TabsList className="flex-wrap">
          <TabsTrigger value="cartao" className="text-xs"><CreditCard className="h-3.5 w-3.5 mr-1" /> Cartão</TabsTrigger>
          <TabsTrigger value="pix" className="text-xs"><Landmark className="h-3.5 w-3.5 mr-1" /> PIX</TabsTrigger>
          <TabsTrigger value="dinheiro" className="text-xs"><Banknote className="h-3.5 w-3.5 mr-1" /> Dinheiro</TabsTrigger>
          <TabsTrigger value="trx-diario" className="text-xs"><CalendarDays className="h-3.5 w-3.5 mr-1" /> Total diário por TRX</TabsTrigger>
          <TabsTrigger value="importacoes" className="text-xs"><Upload className="h-3.5 w-3.5 mr-1" /> Importações</TabsTrigger>
          <TabsTrigger value="codigos" className="text-xs"><FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Códigos TRX</TabsTrigger>
        </TabsList>

        {/* ---------------- Cartão ---------------- */}
        <TabsContent value="cartao" className="mt-4">
          {needsHotel ? NoHotel : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="justificativa" className="text-[11px]">Justificativa</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">Cartões Conciliados</TabsTrigger>
                <TabsTrigger value="b2b" className="text-[11px]">B2B</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  boxes={cardBoxes}
                  onReconcile={doReconcile("cartao")}
                  isReconciling={reconcile.isPending}
                  exportName={`conciliacao-cartao-${hotelId}.xlsx`}
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={[...acquirerCartao, ...operaCartao]}
                  justifications={justifications.data ?? []}
                  kind="cartao"
                  onSave={saveNote("cartao")}
                  saving={saveJustification.isPending}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosPairs
                  matches={cardMatches.data ?? []}
                  rowById={rowById}
                  leftSides={["acquirer"]}
                  title="Cartões conciliados — Adquirente × Front Caixa"
                  exportName={`cartoes-conciliados-${hotelId}.xlsx`}
                  onUndoMany={undoMany}
                  undoing={undo.isPending}
                />
              </TabsContent>
              <TabsContent value="b2b" className="mt-4">
                <ClassifiedList
                  title="Classificados como B2B"
                  subtitle="Saem das pendências de conciliação"
                  rows={b2bRows}
                  actionLabel="Reverter"
                  busy={setB2B.isPending}
                  onAction={(r) => classifyB2B([r], r.side === "acquirer" ? "acquirer" : "opera", false)}
                  exportName={`b2b-${hotelId}.xlsx`}
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
                <TabsTrigger value="direto" className="text-[11px]">Direto no banco</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  boxes={pixBoxes}
                  onReconcile={doReconcile("pix_extrato")}
                  isReconciling={reconcile.isPending}
                  exportName={`conciliacao-pix-${hotelId}.xlsx`}
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={[...acquirerPix, ...operaPix, ...bankPix]}
                  justifications={justifications.data ?? []}
                  kind="pix_extrato"
                  onSave={saveNote("pix_extrato")}
                  saving={saveJustification.isPending}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosPairs
                  matches={pixMatches.data ?? []}
                  rowById={rowById}
                  leftSides={["opera", "acquirer"]}
                  title="PIX conciliados — Opera/Adquirente × Extrato Bancário"
                  exportName={`pix-conciliados-${hotelId}.xlsx`}
                  onUndoMany={undoMany}
                  undoing={undo.isPending}
                />
              </TabsContent>
              <TabsContent value="direto" className="mt-4">
                <ClassifiedList
                  title="Recebidos direto no banco"
                  subtitle="Lançamentos do Opera retirados das pendências"
                  rows={directBankRows}
                  actionLabel="Reverter"
                  busy={setDirectBulk.isPending}
                  onAction={(r) => markDirectBank([r], false)}
                  exportName={`direto-no-banco-${hotelId}.xlsx`}
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
                />
              </TabsContent>
              <TabsContent value="justificativa" className="mt-4">
                <JustificationsPanel
                  rows={operaCash}
                  justifications={justifications.data ?? []}
                  kind="dinheiro"
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
                  rowById={rowById}
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
                    Somatório dos lançamentos do Opera por dia e código de transação (respeita o período selecionado).
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
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trxDaily.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                        Nenhum lançamento no período.
                      </TableCell></TableRow>
                    )}
                    {trxDaily.map((t) => (
                      <TableRow key={`${t.date}-${t.code}`} className="text-[11px]">
                        <TableCell className="tabular-nums">{fmtDay(t.date || null)}</TableCell>
                        <TableCell className="font-mono">{t.code}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{t.desc || "—"}</TableCell>
                        <TableCell className="text-right">{t.count}</TableCell>
                        <TableCell className="text-right"><Money value={t.total} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- Importações ---------------- */}
        <TabsContent value="importacoes" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Relatório do Opera (XML)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar XML do Opera"
                  hint={hotelId ? `Hotel: ${hotelName}` : "Selecione o hotel no filtro do topo antes de importar"}
                  accept={{ "application/xml": [".xml"], "text/xml": [".xml"] }}
                  busy={importOpera.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar o XML do Opera."); return; }
                    importOpera.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(
                        `${r.inserted} transação(ões) importada(s) · ${r.skipped} fora do mapeamento` +
                        ` · ${r.duplicates} já existente(s)` +
                        ` · ${r.autoMatched} conciliada(s) automaticamente`,
                      ),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Operadora (Rede — Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar Excel da operadora"
                  hint={hotelId ? `Filtra pelo CNPJ de ${hotelName}` : "Selecione o hotel no filtro do topo antes de importar"}
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importAcquirer.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar a planilha da operadora."); return; }
                    importAcquirer.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(
                        `${r.inserted} venda(s) importada(s) · ${r.otherHotels} de outros CNPJs descartada(s)` +
                        ` · ${r.duplicates} já existente(s) · ${r.autoMatched} conciliada(s) automaticamente`,
                      ),
                      onError: (e: Error) => toast.error(e.message),
                    });
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Extrato Bancário (Excel)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar extrato bancário"
                  hint='Aba "Lançamentos" — hotel identificado pelo Nome da conta'
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importBank.isPending}
                  onFile={(f) => importBank.mutate({ file: f, hotelIdOverride: hotelId }, {
                    onSuccess: (r) => toast.success(
                      `${r.inserted} lançamento(s) importado(s) — ${r.accountName || r.hotelId}` +
                      ` · ${r.duplicates} já existente(s) · ${r.autoMatched} conciliada(s) automaticamente`,
                    ),
                    onError: (e: Error) => toast.error(e.message),
                  })}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Últimas importações</CardTitle></CardHeader>
            <CardContent className="pb-3 pt-0">
              <Button
                size="sm"
                variant="outline"
                disabled={autoReconcile.isPending}
                onClick={() => autoReconcile.mutate(hotelId, {
                  onSuccess: (n) => toast.success(n ? `${n} par(es) conciliado(s) automaticamente` : "Nenhum par exato pendente"),
                  onError: (e: Error) => toast.error(e.message),
                })}
              >
                Rodar conciliação automática
              </Button>
            </CardContent>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Hotel</TableHead>
                    <TableHead className="text-right">Importados</TableHead>
                    <TableHead className="text-right">Descartados</TableHead>
                    <TableHead className="text-right">Conciliados</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(uploads.data ?? []).map((u) => (
                    <TableRow key={u.id as string} className="text-[11px]">
                      <TableCell>{fmtDateTime(u.uploaded_at as string)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{String(u.kind)}</Badge></TableCell>
                      <TableCell className="max-w-[280px] truncate">{String(u.file_name)}</TableCell>
                      <TableCell>{uploadHotelLabel(u)}</TableCell>
                      <TableCell className="text-right">{Number(u.parsed_count ?? 0)}</TableCell>
                      <TableCell className="text-right">{Number(u.skipped_count ?? 0)}</TableCell>
                      <TableCell className="text-right">
                        {matchedByUpload.data?.get(u.id as string) ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 text-[11px] text-destructive hover:text-destructive"
                          disabled={deleteUpload.isPending}
                          onClick={() => {
                            if (!window.confirm(`Excluir a importação "${String(u.file_name)}" e todos os lançamentos dela?`)) return;
                            deleteUpload.mutate(
                              { id: u.id as string, kind: String(u.kind) },
                              {
                                onSuccess: () => toast.success("Importação excluída."),
                                onError: (e) => toast.error((e as Error).message),
                              },
                            );
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Excluir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(uploads.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">
                      Nenhuma importação ainda.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Códigos TRX ---------------- */}
        <TabsContent value="codigos" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Códigos de transação (Opera)</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Somente códigos ativos entram na conciliação — ativar exige categoria definida.
                </p>
              </div>
              <Input value={trxSearch} onChange={(e) => setTrxSearch(e.target.value)}
                placeholder="Buscar código ou categoria…" className="h-8 w-[240px] text-xs" />
            </CardHeader>
            <CardContent className="p-0 max-h-[560px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Ativo</TableHead>
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
                      <TableCell className="text-right">
                        <Switch
                          checked={c.ativo}
                          onCheckedChange={(v) => {
                            if (v && !c.categoria) {
                              setTrxActivate({ id: c.id, code: c.trx_code, categoria: "" });
                              return;
                            }
                            updateTrx.mutate({ id: c.id, ativo: v }, {
                              onError: (e: Error) => toast.error(e.message),
                            });
                          }}
                        />
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

      {/* Dinheiro — marcar como pago */}
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

      {/* Ativar código TRX exige categoria */}
      <Dialog open={!!trxActivate} onOpenChange={(v) => !v && setTrxActivate(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Ativar código {trxActivate?.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">Defina a categoria antes de ativar o código.</p>
            <Label className="text-xs">Categoria</Label>
            <Input
              className="h-9 text-xs"
              placeholder="CARTAO, PIX, DINHEIRO, FATURADO…"
              value={trxActivate?.categoria ?? ""}
              onChange={(e) => setTrxActivate((p) => (p ? { ...p, categoria: e.target.value } : p))}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTrxActivate(null)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={!trxActivate?.categoria.trim() || updateTrx.isPending}
              onClick={() => {
                if (!trxActivate) return;
                updateTrx.mutate(
                  {
                    id: trxActivate.id,
                    ativo: true,
                    categoria: trxActivate.categoria
                      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(),
                  },
                  {
                    onSuccess: () => { toast.success("Código ativado"); setTrxActivate(null); },
                    onError: (e: Error) => toast.error(e.message),
                  },
                );
              }}
            >
              Ativar
            </Button>
          </DialogFooter>
        </Dialog>
      </Dialog>
    </div>
  );
}
