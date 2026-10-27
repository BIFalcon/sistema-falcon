import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Eye } from "lucide-react";
import { toast } from "sonner";
import { useInvestorAccess, useInvestorMutations, useUnitDetail } from "@/hooks/useInvestors";
import { fmtDate } from "@/components/investidores/StatusSelo";
import { PayeeCard } from "@/components/investidores/PayeeCard";
import { PayeeFormDialog } from "@/components/investidores/PayeeFormDialog";
import { ChangeInvestorDialog } from "@/components/investidores/ChangeInvestorDialog";

export default function UnidadeDetalhePage() {
  const { unitId } = useParams();
  const { data: access, isLoading: al } = useInvestorAccess();
  const [full, setFull] = useState(false);
  const { data, isLoading, error } = useUnitDetail(access?.can_access ? unitId : undefined, full || !!access?.can_view_full);
  const [change, setChange] = useState<null | "investor" | "payee">(null);
  const [editPayee, setEditPayee] = useState(false);
  const { setModalidade } = useInvestorMutations();

  if (al) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!access?.can_access) return <Navigate to="/" replace />;
  if (isLoading || !data) return <div className="p-6 text-muted-foreground">{error ? (error as Error).message : "Carregando…"}</div>;

  const { unit, current, payee, history } = data;
  const canFullToggle = access.can_edit && access.can_view_full && !access.is_finance && !data.full && !!payee;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <Link to={`/investidores?hotel=${unit.hotel_id}`} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-4 w-4" />Investidores</Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-semibold">UH {unit.codigo_uh}</h1><p className="text-sm text-muted-foreground">{unit.hotel_name}</p></div>
        <div className="flex items-center gap-2">
          {access.can_edit ? (
            <Select value={unit.modalidade} onValueChange={(v) => setModalidade.mutateAsync({ unitIds: [unit.id], modalidade: v }).then(() => toast.success("Modalidade alterada")).catch((e) => toast.error(e.message))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pool">Pool</SelectItem><SelectItem value="condo">Condo</SelectItem></SelectContent>
            </Select>
          ) : <span className="text-sm">{unit.modalidade === "pool" ? "Pool" : "Condo"}</span>}
          {access.can_edit && <Button onClick={() => setChange("investor")}>Trocar investidor</Button>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Investidor vigente</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {current ? (<>
              <Link to={`/investidores/investidor/${current.investor_id}`} className="font-medium text-primary hover:underline">{current.investor_nome}</Link>
              <div className="text-muted-foreground">{current.investor_documento ?? "sem documento"}{!current.ativo && " · inativo"}</div>
              <div>Vigente desde {fmtDate(current.data_inicio)}</div>
            </>) : <p className="text-muted-foreground">Sem investidor vinculado.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Favorecido</CardTitle>
            <div className="flex gap-2">
              {canFullToggle && <Button size="sm" variant="outline" onClick={() => setFull(true)}><Eye className="h-4 w-4 mr-1" />Mostrar dados completos</Button>}
              {access.can_edit && current && payee && <Button size="sm" variant="outline" onClick={() => setEditPayee(true)}>Editar</Button>}
              {access.can_edit && current && <Button size="sm" variant="outline" onClick={() => setChange("payee")}>Trocar</Button>}
            </div>
          </CardHeader>
          <CardContent>
            {payee ? <PayeeCard p={payee} /> : <p className="text-sm text-muted-foreground">Sem favorecido — dados de recebimento pendentes.</p>}
            {data.full && <p className="text-xs text-muted-foreground mt-2">Visualização de dados completos registrada na auditoria.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico de vínculos</CardTitle></CardHeader>
        <CardContent>
          <ol className="relative border-l pl-5 space-y-4">
            {history.map((h) => (
              <li key={h.id} className="text-sm">
                <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${h.data_fim ? "bg-muted-foreground/40" : "bg-primary"}`} />
                <div className="font-medium">{h.investor_nome}{h.payee_nome && h.payee_nome !== h.investor_nome ? ` · favorecido ${h.payee_nome}` : ""}</div>
                <div className="text-muted-foreground">{fmtDate(h.data_inicio)} → {h.data_fim ? fmtDate(h.data_fim) : "vigente"}{h.motivo_troca ? ` · ${h.motivo_troca}` : ""}{h.created_by ? ` · por ${h.created_by}` : ""}</div>
              </li>
            ))}
            {history.length === 0 && <li className="text-sm text-muted-foreground">Sem histórico.</li>}
          </ol>
        </CardContent>
      </Card>

      {change && <ChangeInvestorDialog open={!!change} onOpenChange={(o) => !o && setChange(null)} unitId={unit.id} currentInvestorId={current?.investor_id ?? null} mode={change} />}
      {current && <PayeeFormDialog open={editPayee} onOpenChange={setEditPayee} investorId={current.investor_id} payee={payee} />}
    </div>
  );
}
