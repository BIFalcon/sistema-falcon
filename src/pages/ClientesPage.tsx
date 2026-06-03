import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useArClients, useUpsertArClient, useDeleteArClient, type ArClient } from "@/hooks/useArClients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyHotelState } from "@/components/ui/EmptyHotelState";
import { Users } from "lucide-react";

interface FormState {
  id?: string;
  name: string;
  cnpj_cpf: string;
  email: string;
  payment_term_days: number;
  notes: string;
}

const EMPTY: FormState = { name: "", cnpj_cpf: "", email: "", payment_term_days: 30, notes: "" };

export default function ClientesPage() {
  const { hasRole, isMaster, allowedHotels } = useAuth();
  const { hotelId } = useModuleFilters("financeiro");

  const canEdit = isMaster || hasRole("financeiro") || hasRole("adm") || hasRole("gg");

  const { data: clients = [], isLoading } = useArClients(hotelId);
  const upsert = useUpsertArClient();
  const del = useDeleteArClient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDel, setConfirmDel] = useState<ArClient | null>(null);

  const sorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name)), [clients]);

  function openCreate() { setForm(EMPTY); setOpen(true); }
  function openEdit(c: ArClient) {
    setForm({
      id: c.id,
      name: c.name,
      cnpj_cpf: c.cnpj_cpf ?? "",
      email: c.email ?? "",
      payment_term_days: c.payment_term_days,
      notes: c.notes ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!hotelId) return;
    if (!form.name.trim()) { toast.error("Informe o nome do cliente"); return; }
    try {
      await upsert.mutateAsync({
        id: form.id,
        hotel_id: hotelId,
        name: form.name.trim(),
        cnpj_cpf: form.cnpj_cpf.trim() || null,
        email: form.email.trim() || null,
        payment_term_days: Math.max(0, Number(form.payment_term_days) || 0),
        notes: form.notes.trim() || null,
      });
      toast.success(form.id ? "Cliente atualizado" : "Cliente cadastrado");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete() {
    if (!confirmDel) return;
    try {
      await del.mutateAsync({ id: confirmDel.id, hotel_id: confirmDel.hotel_id });
      toast.success("Cliente removido");
      setConfirmDel(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!hotelId) {
    return (
      <EmptyHotelState
        icon={<Users className="h-16 w-16" />}
        title="Selecione um hotel"
        description={
          allowedHotels.length === 0
            ? "Você não tem hotéis atribuídos."
            : "Use o filtro no topo para escolher o hotel."
        }
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de clientes (contratos) com prazo de pagamento.
          </p>
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Novo cliente</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{form.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>CNPJ/CPF</Label>
                    <Input value={form.cnpj_cpf} onChange={(e) => setForm({ ...form, cnpj_cpf: e.target.value })} />
                  </div>
                  <div>
                    <Label>Prazo (dias) *</Label>
                    <Input
                      type="number" min={0}
                      value={form.payment_term_days}
                      onChange={(e) => setForm({ ...form, payment_term_days: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={upsert.isPending}>
                  {upsert.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ/CPF</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="text-right">Prazo (dias)</TableHead>
              <TableHead className="w-[120px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum cliente cadastrado.</TableCell></TableRow>
            ) : sorted.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.cnpj_cpf ?? "—"}</TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell className="text-right">{c.payment_term_days}</TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDel(c)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente. Lançamentos vinculados manterão a referência em branco.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}