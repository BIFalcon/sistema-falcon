import { useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrDateInput } from '@/components/ui/br-date-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { useSimulationActions } from '@/hooks/useAnticipationSimulations';
import { validSimulation, unconfirmedDays, type AnticipationSimulation } from '@/lib/anticipationSimulation';
import { fmtBRL, fmtDate } from '@/lib/formatters';

export function AnticipationSimulations({hotelId, rows, userId, master}: {hotelId:string; rows:AnticipationSimulation[]; userId:string | undefined; master:boolean}) {
  const {save,remove} = useSimulationActions();
  const [open,setOpen] = useState(false);
  const [editing,setEditing] = useState<string | undefined>();
  const [deleting,setDeleting] = useState<string | null>(null);
  const [form,setForm] = useState({date:format(new Date(),'yyyy-MM-dd'),gross:'',discount:'',net:''});
  const start = (row?:AnticipationSimulation) => {
    setEditing(row?.id);
    setForm({date:row?.data_antecipacao ?? format(new Date(),'yyyy-MM-dd'),gross:row ? String(row.anticipated_amount) : '',discount:row ? String(row.valor_descontado ?? 0) : '',net:row ? String(row.valor_liquido ?? 0) : ''});
    setOpen(true);
  };
  const change = (field:'gross'|'discount', value:string) => setForm(p => {
    const next = {...p,[field]:value}; return {...next,net:(Number(next.gross)-Number(next.discount)).toFixed(2)};
  });
  return <section className="space-y-3 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Antecipações simuladas</h3><Button size="sm" variant="outline" onClick={()=>start()}><Plus className="h-4 w-4 mr-1"/>Simular antecipação</Button></div>
    <div className="max-h-72 overflow-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Bruto</TableHead><TableHead>Desconto</TableHead><TableHead>Líquido</TableHead><TableHead>Situação</TableHead><TableHead/></TableRow></TableHeader><TableBody>
      {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center">Nenhuma simulação.</TableCell></TableRow>}
      {rows.map(r => {const days=unconfirmedDays(r); const editable=r.status==='simulada' && (master || r.created_by===userId); return <TableRow key={r.id}><TableCell>{fmtDate(r.data_antecipacao)}</TableCell><TableCell>{fmtBRL(r.anticipated_amount)}</TableCell><TableCell>{fmtBRL(r.valor_descontado ?? 0)}</TableCell><TableCell>{fmtBRL(r.valor_liquido ?? 0)}</TableCell><TableCell><Badge variant="outline" className={days>3?'border-warning text-warning':''} title={r.status==='confirmada'?'Confirmada pelo relatório; não entra no saldo projetado.':undefined}>{r.status==='confirmada'?'Confirmada pelo relatório':days>3?`Não confirmada há ${days} dias`:'Simulada'}</Badge></TableCell><TableCell>{editable && <div className="flex"><Button size="icon" variant="ghost" aria-label="Editar simulação" title="Editar simulação" onClick={()=>start(r)}><Pencil className="h-4 w-4"/></Button><Button size="icon" variant="ghost" aria-label="Excluir simulação" title="Excluir simulação" onClick={()=>setDeleting(r.id)}><Trash2 className="h-4 w-4"/></Button></div>}</TableCell></TableRow>})}
    </TableBody></Table></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing?'Editar simulação':'Simular antecipação'}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-4"><div><Label>Data planejada</Label><BrDateInput value={form.date} onChange={date=>setForm({...form,date})}/></div>
      {(['gross','discount','net'] as const).map(field=><div key={field}><Label htmlFor={`simulation-${field}`}>{field==='gross'?'Valor bruto (R$)':field==='discount'?'Taxa / desconto (R$)':'Valor líquido (R$)'}</Label><Input id={`simulation-${field}`} type="number" min="0" step="0.01" value={form[field]} onChange={e=>field==='net'?setForm({...form,net:e.target.value}):change(field,e.target.value)}/></div>)}</div>
      <DialogFooter><Button variant="ghost" onClick={()=>setOpen(false)}>Cancelar</Button><Button disabled={save.isPending || !form.date || !validSimulation(Number(form.gross),Number(form.discount),Number(form.net))} onClick={()=>save.mutate({hotel:hotelId,date:form.date,gross:Number(form.gross),discount:Number(form.discount),net:Number(form.net),id:editing},{onSuccess:()=>{setOpen(false);toast.success('Simulação salva');},onError:e=>toast.error(e.message)})}>{save.isPending?'Salvando…':'Salvar simulação'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={v=>!v&&setDeleting(null)}><DialogContent><DialogHeader><DialogTitle>Excluir esta simulação?</DialogTitle></DialogHeader><DialogFooter><Button variant="ghost" onClick={()=>setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={remove.isPending} onClick={()=>{if(deleting) remove.mutate(deleting,{onSuccess:()=>{setDeleting(null);toast.success('Simulação excluída');},onError:e=>toast.error(e.message)});}}>Excluir</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}