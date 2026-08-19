import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Banknote, CheckCircle2, CreditCard, Download, FileSpreadsheet, Landmark,
  Loader2, Undo2, Upload, Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { fmtBRL, fmtDateTime } from "@/lib/formatters";
import { ReconcilePanel, Money, fmtDay, exportRows, type ReconcileRow } from "@/components/conciliacao/ReconcilePanel";
import {
  useAcquirerEntries, useBankEntries, useConcMatches, useConcUploads, useImportAcquirer,
  useImportBankStatement, useImportOpera, useOperaEntries, useReconcile, useSetDirectBank,
  useTrxCodeMapping, useUndoReconcile, useUpdateTrxCode,
  type ConcKind, type ConcMatch,
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

/* ------------------------------------------------------------------ */

function MatchHistory({ matches, onUndo, undoing, exportName }: {
  matches: ConcMatch[]; onUndo: (m: ConcMatch) => void; undoing: boolean; exportName: string;
}) {
  const leftSum = matches.reduce((s, m) => s + Number(m.left_total), 0);
  const rightSum = matches.reduce((s, m) => s + Number(m.right_total), 0);

  const handleExport = () => {
    const rows = matches.map((m) => ({
      "Conciliado em": fmtDateTime(m.matched_at),
      "Lançamentos": m.conc_match_items.length,
      "Total esquerda": Number(m.left_total),
      "Total direita": Number(m.right_total),
      Diferença: Number(m.difference),
      Observação: m.note ?? "",
    }));
    rows.push({
      "Conciliado em": "TOTAL", "Lançamentos": matches.length,
      "Total esquerda": leftSum, "Total direita": rightSum,
      Diferença: leftSum - rightSum, Observação: "",
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Conciliados");
    XLSX.writeFile(wb, exportName);
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Histórico de conciliações</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {matches.length} conciliação(ões) · Esquerda <Money value={leftSum} /> · Direita <Money value={rightSum} /> · Diferença{" "}
            <span className="tabular-nums">{fmtBRL(leftSum - rightSum)}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport}>
          <Download className="h-3 w-3 mr-1" /> Exportar Excel
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="text-[11px]">
              <TableHead>Data</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead className="text-right">Esquerda</TableHead>
              <TableHead className="text-right">Direita</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                Nenhuma conciliação registrada.
              </TableCell></TableRow>
            )}
            {matches.map((m) => (
              <TableRow key={m.id} className="text-[11px]">
                <TableCell>{fmtDateTime(m.matched_at)}</TableCell>
                <TableCell>{m.conc_match_items.length}</TableCell>
                <TableCell className="text-right"><Money value={Number(m.left_total)} /></TableCell>
                <TableCell className="text-right"><Money value={Number(m.right_total)} /></TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(Number(m.difference))}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]" disabled={undoing} onClick={() => onUndo(m)}>
                    <Undo2 className="h-3 w-3 mr-1" /> Desfazer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ConciliadosList({ rows, title, exportName }: { rows: ReconcileRow[]; title: string; exportName: string }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {rows.length} lançamento(s) · Total <Money value={total} />
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px]"
          onClick={() => exportRows(rows, exportName, { "TOTAL": total })}>
          <Download className="h-3 w-3 mr-1" /> Exportar Excel
        </Button>
      </CardHeader>
      <CardContent className="p-0 max-h-[520px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-[11px]">
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">
                Nada conciliado ainda.
              </TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="text-[11px]">
                <TableCell>{fmtDay(r.date)}</TableCell>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell className="text-muted-foreground">{r.subtitle}</TableCell>
                <TableCell className="text-right"><Money value={r.amount} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function ConciliacaoCartaoPage() {
  const { allowedHotels } = useAuth();
  // Usa os mesmos filtros globais de Contas a Receber (hotel + período do topo).
  const { hotelId, dateFrom, dateTo } = useModuleFilters("financeiro");

  const opera = useOperaEntries(hotelId, dateFrom, dateTo);
  const acquirer = useAcquirerEntries(hotelId, dateFrom, dateTo);
  const bank = useBankEntries(hotelId, dateFrom, dateTo);
  const cardMatches = useConcMatches(hotelId, "cartao");
  const pixMatches = useConcMatches(hotelId, "pix_extrato");

  const reconcile = useReconcile();
  const undo = useUndoReconcile();
  const setDirect = useSetDirectBank();

  const importOpera = useImportOpera();
  const importAcquirer = useImportAcquirer();
  const importBank = useImportBankStatement();
  const uploads = useConcUploads();
  const trxCodes = useTrxCodeMapping();
  const updateTrx = useUpdateTrxCode();
  const [trxSearch, setTrxSearch] = useState("");

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

  // Tela 1 — pendências (sem par e sem "recebido direto no banco")
  const operaPendentes = operaRows.filter((r) => {
    const e = operaById.get(r.id);
    return e && !e.matched_at && !e.direct_bank;
  }).map((r) => {
    const e = operaById.get(r.id)!;
    return {
      ...r,
      extra: (
        <Button
          variant="ghost" size="sm" className="h-5 px-1 text-[10px]"
          onClick={(ev) => {
            ev.stopPropagation();
            setDirect.mutate({ id: e.id, value: true }, {
              onSuccess: () => toast.success("Marcado como recebido direto no banco"),
              onError: (err: Error) => toast.error(err.message),
            });
          }}
        >
          <Landmark className="h-3 w-3 mr-0.5" /> Direto no banco
        </Button>
      ),
    };
  });
  const acquirerPendentes = acquirerRows.filter((r) => !(acquirer.data ?? []).find((e) => e.id === r.id)?.matched_at);

  // Tela 2 — PIX do Opera × extrato bancário (linhas com "PIX" e valor positivo)
  const operaPixPendentes = operaPendentes.filter((r) => isPix(operaById.get(r.id)?.categoria));
  const bankPixPendentes = bankRows.filter((r) => {
    const e = (bank.data ?? []).find((b) => b.id === r.id);
    return e && !e.matched_at && Number(e.amount) > 0 && (e.description ?? "").toUpperCase().includes("PIX");
  });

  const conciliadosCartao = [
    ...operaRows.filter((r) => operaById.get(r.id)?.matched_at),
    ...acquirerRows.filter((r) => (acquirer.data ?? []).find((e) => e.id === r.id)?.matched_at),
  ];
  const conciliadosPix = [
    ...operaRows.filter((r) => operaById.get(r.id)?.matched_at && isPix(operaById.get(r.id)?.categoria)),
    ...bankRows.filter((r) => (bank.data ?? []).find((e) => e.id === r.id)?.matched_at),
  ];

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

  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name ?? "";
  const needsHotel = !hotelId;

  const trxVisible = (trxCodes.data ?? []).filter((c) => {
    const t = trxSearch.trim().toLowerCase();
    if (!t) return true;
    return [c.trx_code, c.descricao, c.categoria].filter(Boolean).some((v) => String(v).toLowerCase().includes(t));
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Opera × Operadora × Extrato bancário — conciliação manual pelo financeiro.
        {hotelId ? <> Hotel: <span className="font-medium text-foreground">{hotelName}</span>.</> : null}{" "}
        Use os filtros de hotel e período no topo da página.
      </p>

      <Tabs defaultValue="cartao">
        <TabsList>
          <TabsTrigger value="cartao" className="text-xs"><CreditCard className="h-3.5 w-3.5 mr-1" /> Cartão e PIX</TabsTrigger>
          <TabsTrigger value="pix" className="text-xs"><Landmark className="h-3.5 w-3.5 mr-1" /> PIX × Extrato</TabsTrigger>
          <TabsTrigger value="dinheiro" className="text-xs"><Banknote className="h-3.5 w-3.5 mr-1" /> Dinheiro</TabsTrigger>
          <TabsTrigger value="importacoes" className="text-xs"><Upload className="h-3.5 w-3.5 mr-1" /> Importações</TabsTrigger>
          <TabsTrigger value="codigos" className="text-xs"><FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Códigos TRX</TabsTrigger>
        </TabsList>

        {/* Tela 1 */}
        <TabsContent value="cartao" className="mt-4">
          {needsHotel ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              Selecione uma empresa/hotel para começar.
            </CardContent></Card>
          ) : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="historico" className="text-[11px]">Front Caixa × Adquirente</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">Cartões Conciliados</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  leftTitle="Adquirente"
                  leftSubtitle="Operadora (Rede) — vendas aprovadas/pagas"
                  rightTitle="Front Caixa"
                  rightSubtitle="Opera — transações de cartão/PIX"
                  leftRows={acquirerPendentes}
                  rightRows={operaPendentes}
                  onReconcile={(l, r) => doReconcile("cartao")(l, r)}
                  isReconciling={reconcile.isPending}
                  exportPrefix={`conciliacao-cartao-${hotelId}`}
                />
              </TabsContent>
              <TabsContent value="historico" className="mt-4">
                <MatchHistory
                  matches={cardMatches.data ?? []}
                  onUndo={(m) => undo.mutate(m, {
                    onSuccess: () => toast.success("Conciliação desfeita"),
                    onError: (e: Error) => toast.error(e.message),
                  })}
                  undoing={undo.isPending}
                  exportName={`historico-cartao-${hotelId}.xlsx`}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosList rows={conciliadosCartao} title="Cartões conciliados" exportName={`cartoes-conciliados-${hotelId}.xlsx`} />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* Tela 2 */}
        <TabsContent value="pix" className="mt-4">
          {needsHotel ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              Selecione uma empresa/hotel para começar.
            </CardContent></Card>
          ) : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes" className="text-[11px]">Não Conciliados</TabsTrigger>
                <TabsTrigger value="historico" className="text-[11px]">Histórico</TabsTrigger>
                <TabsTrigger value="conciliados" className="text-[11px]">PIX Conciliados</TabsTrigger>
              </TabsList>
              <TabsContent value="pendentes" className="mt-4">
                <ReconcilePanel
                  leftTitle="Opera (PIX)"
                  leftSubtitle="Reservas classificadas como PIX"
                  rightTitle="Extrato Bancário"
                  rightSubtitle='Lançamentos com "PIX" e valor positivo'
                  leftRows={operaPixPendentes}
                  rightRows={bankPixPendentes}
                  onReconcile={(l, r) => doReconcile("pix_extrato")(l, r)}
                  isReconciling={reconcile.isPending}
                  exportPrefix={`conciliacao-pix-${hotelId}`}
                />
              </TabsContent>
              <TabsContent value="historico" className="mt-4">
                <MatchHistory
                  matches={pixMatches.data ?? []}
                  onUndo={(m) => undo.mutate(m, {
                    onSuccess: () => toast.success("Conciliação desfeita"),
                    onError: (e: Error) => toast.error(e.message),
                  })}
                  undoing={undo.isPending}
                  exportName={`historico-pix-${hotelId}.xlsx`}
                />
              </TabsContent>
              <TabsContent value="conciliados" className="mt-4">
                <ConciliadosList rows={conciliadosPix} title="PIX conciliados" exportName={`pix-conciliados-${hotelId}.xlsx`} />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* Dinheiro — reservado */}
        <TabsContent value="dinheiro" className="mt-4">
          <Card>
            <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
              <Wallet className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Conciliação de Dinheiro</p>
              <p className="text-xs text-muted-foreground max-w-md">
                Espaço reservado. As regras de conciliação de dinheiro serão definidas em uma fase seguinte.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Importações */}
        <TabsContent value="importacoes" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Relatório do Opera (XML)</CardTitle></CardHeader>
              <CardContent>
                <DropZone
                  label="Enviar XML do Opera"
                  hint={hotelId ? `Hotel: ${hotelName}` : "Selecione o hotel acima antes de importar"}
                  accept={{ "application/xml": [".xml"], "text/xml": [".xml"] }}
                  busy={importOpera.isPending}
                  onFile={(f) => {
                    if (!hotelId) { toast.error("Selecione o hotel antes de importar o XML do Opera."); return; }
                    importOpera.mutate({ file: f, hotelId }, {
                      onSuccess: (r) => toast.success(`${r.inserted} transação(ões) importada(s) · ${r.skipped} fora do mapeamento`),
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
                  hint="Hotel identificado pelo nome do estabelecimento"
                  accept={{ "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }}
                  busy={importAcquirer.isPending}
                  onFile={(f) => importAcquirer.mutate({ file: f }, {
                    onSuccess: (r) => toast.success(
                      `${r.inserted} venda(s) importada(s) · ${r.skipped} descartada(s)` +
                      (r.unmatched.length ? ` · sem hotel: ${r.unmatched.slice(0, 3).join(", ")}` : ""),
                    ),
                    onError: (e: Error) => toast.error(e.message),
                  })}
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
                    onSuccess: (r) => toast.success(`${r.inserted} lançamento(s) importado(s) — ${r.accountName || r.hotelId}`),
                    onError: (e: Error) => toast.error(e.message),
                  })}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Últimas importações</CardTitle></CardHeader>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(uploads.data ?? []).map((u) => (
                    <TableRow key={u.id as string} className="text-[11px]">
                      <TableCell>{fmtDateTime(u.uploaded_at as string)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{String(u.kind)}</Badge></TableCell>
                      <TableCell className="max-w-[280px] truncate">{String(u.file_name)}</TableCell>
                      <TableCell>{allowedHotels.find((h) => h.id === u.hotel_id)?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{Number(u.parsed_count ?? 0)}</TableCell>
                      <TableCell className="text-right">{Number(u.skipped_count ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                  {(uploads.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                      Nenhuma importação ainda.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Códigos TRX */}
        <TabsContent value="codigos" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Códigos de transação (Opera)</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Somente códigos ativos entram na conciliação.
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
                          onCheckedChange={(v) => updateTrx.mutate({ id: c.id, ativo: v }, {
                            onError: (e: Error) => toast.error(e.message),
                          })}
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
      {!needsHotel && operaRows.length === 0 && acquirerRows.length === 0 && bankRows.length === 0 && !opera.isLoading && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Nenhum dado no período — importe os relatórios na aba Importações.
        </p>
      )}
    </div>
  );
}
