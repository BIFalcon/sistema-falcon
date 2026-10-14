import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Eye, Plus } from "lucide-react";
import { toast } from "sonner";
import { useInvestorAccess, useInvestorDetail, useInvestorMutations, type PayeeJson } from "@/hooks/useInvestors";
import { StatusSelo, fmtDate } from "@/components/investidores/StatusSelo";
import { PayeeCard } from "@/components/investidores/PayeeCard";
import { PayeeFormDialog } from "@/components/investidores/PayeeFormDialog";

export default function InvestidorDetalhePage() {
  const { investorId } = useParams();
  const { data: access, isLoading: al } = useInvestorAccess();
  const [full, setFull] = useState(false);
  const { data, isLoading, error } = useInvestorDetail(access?.can_access ? investorId : undefined, full || !!access?.can_view_full);
  const [payeeDlg, setPayeeDlg] = useState<{ open: boolean; payee: PayeeJson | null }>({ open: false, payee: null });
  const { setActive } = useInvestorMutations();

  if (al) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!access?.can_access) return <Navigate to="/" replace />;
  if (isLoading || !data) return <div className="p-6 text-muted-foreground">{error ? (error as Error).message : "Carregando…"}</div>;
  const { investor, payees, units } = data;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <Link to="/investidores" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-4 w-4" />Investidores</Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{investor.codigo_externo ? `${investor.codigo_externo} - ` : ""}{investor.nome}</h1>
          <p className="text-sm text-muted-foreground">{investor.documento ?? "sem documento"} · {investor.email ?? "sem e-mail"} · {investor.telefone ?? "sem telefone"}{!investor.ativo && " · INATIVO"}</p>
        </div>
        <div className="flex gap-2">
          {access.can_edit && access.can_view_full && !access.is_finance && !data.full && <Button variant="outline" onClick={() => setFull(true)}><Eye className="h-4 w-4 mr-1" />Mostrar dados completos</Button>}
          {access.can_edit && <Button variant="outline" onClick={() => setActive.mutateAsync({ id: investor.id, ativo: !investor.ativo }).then(() => toast.success(investor.ativo ? "Investidor inativado" : "Investidor reativado")).catch((e) => toast.error(e.message))}>{investor.ativo ? "Inativar" : "Reativar"}</Button>}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Unidades vinculadas</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Hotel</TableHead><TableHead>UH</TableHead><TableHead>Modalidade</TableHead><TableHead>Favorecido</TableHead><TableHead>Status</TableHead><TableHead>Período</TableHead></TableRow></TableHeader>
          <TableBody>
            {units.map((u, i) => (
              <TableRow key={u.unit_id + i} className={u.data_fim ? "opacity-60" : ""}>
                <TableCell>{u.hotel_name}</TableCell>
                <TableCell><Link className="text-primary hover:underline" to={`/investidores/uh/${u.unit_id}`}>{u.codigo_uh}</Link></TableCell>
                <TableCell>{u.modalidade === "pool" ? "Pool" : "Condo"}</TableCell>
                <TableCell>{u.payee_nome ?? "—"}</TableCell>
                <TableCell><StatusSelo status={u.status_dados} /></TableCell>
                <TableCell>{fmtDate(u.data_inicio)} → {u.data_fim ? fmtDate(u.data_fim) : "vigente"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Favorecidos</CardTitle>
          {access.can_edit && <Button size="sm" variant="outline" onClick={() => setPayeeDlg({ open: true, payee: null })}><Plus className="h-4 w-4 mr-1" />Novo favorecido</Button>}
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          {payees.map((p) => (
            <div key={p.id} className="space-y-1">
              <PayeeCard p={p} />
              {access.can_edit && <Button size="sm" variant="ghost" onClick={() => setPayeeDlg({ open: true, payee: p })}>Editar</Button>}
            </div>
          ))}
          {payees.length === 0 && <p className="text-sm text-muted-foreground">Nenhum favorecido cadastrado.</p>}
        </CardContent>
      </Card>

      <PayeeFormDialog open={payeeDlg.open} onOpenChange={(o) => setPayeeDlg((s) => ({ ...s, open: o }))} investorId={investor.id} payee={payeeDlg.payee} />
    </div>
  );
}
