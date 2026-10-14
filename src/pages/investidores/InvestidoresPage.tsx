import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { useModuleFilters } from "@/contexts/FilterContext";
import { fetchPendingExport, useInvestorAccess, useInvestorMutations, useInvestorStats, useInvestorUnits } from "@/hooks/useInvestors";
import { StatusSelo, fmtDate } from "@/components/investidores/StatusSelo";
import { ImportInvestorsDialog } from "@/components/investidores/ImportInvestorsDialog";

const ALL = "__all";
const PAGE = 50;

export default function InvestidoresPage() {
  const { data: access, isLoading: accessLoading } = useInvestorAccess();
  const [params, setParams] = useSearchParams();
  const { hotelId, setHotelId } = useModuleFilters("global");
  useEffect(() => {
    const h = params.get("hotel");
    if (h) { setHotelId(h); const p = new URLSearchParams(params); p.delete("hotel"); setParams(p, { replace: true }); }
  }, [params, setHotelId, setParams]);
  const [modalidade, setModalidade] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [obsOpen, setObsOpen] = useState(false);
  const [obs, setObs] = useState("aguardando termo de adesão ao pool assinado");
  const muts = useInvestorMutations();

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 350); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [hotelId, modalidade, status, search]);

  const enabled = !!access?.can_access;
  const { data: stats } = useInvestorStats(hotelId, modalidade, enabled);
  const { data: rows = [], isFetching } = useInvestorUnits({ hotelId, modalidade, search, status, page, pageSize: PAGE }, enabled);
  const total = rows[0]?.total_count ?? 0;

  if (accessLoading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!access?.can_access) return <Navigate to="/" replace />;

  const exportPend = async () => {
    try {
      const data = await fetchPendingExport(hotelId);
      const ws = XLSX.utils.json_to_sheet(data.map((r) => ({ Hotel: r.hotel_name, UH: r.codigo_uh, Investidor: r.investidor ?? "", Favorecido: r.favorecido ?? "", Status: r.status_dados, "O que falta": r.falta ?? "", Observação: r.observacao ?? "" })));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Pendências");
      XLSX.writeFile(wb, `pendencias-investidores-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao exportar"); }
  };

  const selectedPayees = rows.filter((r) => selected.has(r.unit_id) && r.payee_id).map((r) => r.payee_id!) ;
  const selectedUnits = Array.from(selected);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Investidores</h1>
          <p className="text-sm text-muted-foreground">Unidades, investidores e dados de recebimento</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportPend}><Download className="h-4 w-4 mr-2" />Exportar pendências</Button>
          {access.can_edit && <Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-2" />Importar planilha</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Total de UHs", stats?.total_uhs], ["Investidores distintos", stats?.investidores], ["UHs Pool", stats?.uhs_pool], ["Dados pendentes ou parciais", stats?.pendentes_parciais]].map(([l, v]) => (
          <Card key={String(l)}><CardContent className="p-4"><div className="text-2xl font-semibold">{v ?? "—"}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Select value={modalidade ?? ALL} onValueChange={(v) => setModalidade(v === ALL ? null : v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Pool e Condo</SelectItem><SelectItem value="pool">Pool</SelectItem><SelectItem value="condo">Condo</SelectItem></SelectContent>
        </Select>
        <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? null : v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Todos os status</SelectItem><SelectItem value="completo">Completo</SelectItem><SelectItem value="parcial">Parcial</SelectItem><SelectItem value="pendente">Pendente</SelectItem><SelectItem value="nao_completo">Pendente ou parcial</SelectItem></SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar UH, investidor, favorecido ou documento" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      </div>

      {access.can_edit && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 text-sm">
          <span>{selected.size} selecionada(s)</span>
          <Button size="sm" variant="outline" onClick={() => muts.setModalidade.mutateAsync({ unitIds: selectedUnits, modalidade: "pool" }).then((n) => toast.success(`${n} UH(s) alteradas para Pool`)).catch((e) => toast.error(e.message))}>Marcar Pool</Button>
          <Button size="sm" variant="outline" onClick={() => muts.setModalidade.mutateAsync({ unitIds: selectedUnits, modalidade: "condo" }).then((n) => toast.success(`${n} UH(s) alteradas para Condo`)).catch((e) => toast.error(e.message))}>Marcar Condo</Button>
          <Button size="sm" variant="outline" disabled={selectedPayees.length === 0} onClick={() => setObsOpen(true)}>Observação em lote</Button>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {access.can_edit && <TableHead className="w-8" />}
              <TableHead>UH</TableHead>
              {!hotelId && <TableHead>Hotel</TableHead>}
              <TableHead>Investidor</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Dados de recebimento</TableHead>
              <TableHead>Vigente desde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{isFetching ? "Carregando…" : "Nenhuma UH encontrada."}</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.unit_id}>
                {access.can_edit && <TableCell><Checkbox checked={selected.has(r.unit_id)} onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(r.unit_id); else n.delete(r.unit_id); return n; })} /></TableCell>}
                <TableCell className="font-medium"><Link className="text-primary hover:underline" to={`/investidores/uh/${r.unit_id}`}>{r.codigo_uh}</Link></TableCell>
                {!hotelId && <TableCell>{r.hotel_name}</TableCell>}
                <TableCell>{r.investor_id ? <Link className="hover:underline" to={`/investidores/investidor/${r.investor_id}`}>{r.investor_nome}</Link> : "—"}<div className="text-xs text-muted-foreground">{r.investor_documento}</div></TableCell>
                <TableCell>{r.modalidade === "pool" ? "Pool" : "Condo"}</TableCell>
                <TableCell><StatusSelo status={r.status_dados} /></TableCell>
                <TableCell>{fmtDate(r.vigente_desde)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">{total === 0 ? "0" : `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, total)} de ${total}`}</span>
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
      </div>

      {importOpen && <ImportInvestorsDialog open={importOpen} onOpenChange={setImportOpen} defaultHotelId={hotelId} />}

      <Dialog open={obsOpen} onOpenChange={setObsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Observação em lote ({selectedPayees.length} favorecido(s))</DialogTitle></DialogHeader>
          <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          <DialogFooter>
            <Button onClick={() => muts.setObservacao.mutateAsync({ payeeIds: selectedPayees, observacao: obs }).then((n) => { toast.success(`Observação gravada em ${n} favorecido(s)`); setObsOpen(false); }).catch((e) => toast.error(e.message))}>Gravar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
