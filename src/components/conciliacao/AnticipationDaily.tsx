import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAnticipationSimulations, useSimulationActions } from '@/hooks/useAnticipationSimulations';
import { anticipatedDaily, canSimulateAnticipation, type AnticipatedPayment } from '@/lib/anticipationSimulation';
import { isAntecipacao } from '@/lib/redeRecebimentos';
import { fmtBRL, fmtDate } from '@/lib/formatters';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export function AnticipationDaily({hotelId,payments,fees}: {hotelId:string;payments:AnticipatedPayment[];fees:{data_ajuste:string|null;motivo:string|null;valor_cobrado:number|null}[]}) {
  const {isMaster,hasRole} = useAuth();
  const allowed = canSimulateAnticipation(isMaster,['fernando','patronos','controladoria'].filter(r=>hasRole(r as 'fernando'|'patronos'|'controladoria')));
  const sims = useAnticipationSimulations(hotelId,allowed);
  const {reconcile} = useSimulationActions();
  const opened = useRef<string | null>(null);
  const [decision,setDecision] = useState<{date:string;decision:'confirmar'|'ajustar'} | null>(null);
  useEffect(()=>{
    if (!allowed || opened.current===hotelId) return;
    opened.current=hotelId;
    reconcile.mutate({hotel:hotelId},{onError:e=>toast.error(`Falha ao conferir antecipações: ${e.message}`)});
  },[hotelId,allowed,reconcile]);
  return <>
    <div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Líquido antecipado (recebimento)</TableHead><TableHead>Taxa (despesa)</TableHead>{allowed && <><TableHead>Simulado</TableHead><TableHead>Diferença</TableHead><TableHead>Situação</TableHead><TableHead/></>}</TableRow></TableHeader><TableBody>
      {anticipatedDaily(payments).map(r=>{
        const rows=(sims.data ?? []).filter(s=>s.data_antecipacao===r.date);
        const total=rows.reduce((s,a)=>s+Number(a.valor_liquido ?? 0),0);
        const pending=rows.some(s=>s.status==='simulada');
        const fee=fees.filter(f=>f.data_ajuste===r.date&&isAntecipacao(f.motivo)).reduce((s,f)=>s+Math.abs(Number(f.valor_cobrado ?? 0)),0);
        return <TableRow key={r.date}><TableCell>{fmtDate(r.date)}</TableCell><TableCell>{fmtBRL(r.net)}</TableCell><TableCell>{fmtBRL(fee)}</TableCell>{allowed && <><TableCell>{rows.length?fmtBRL(total):'—'}</TableCell><TableCell>{rows.length?fmtBRL(r.net-total):'—'}</TableCell><TableCell>{sims.isLoading?'Conferindo…':sims.isError?'Falha na consulta':!rows.length?'Sem simulação':pending?'Divergente':'Confirmada'}</TableCell><TableCell>{pending && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={reconcile.isPending} onClick={()=>setDecision({date:r.date,decision:'confirmar'})}>Confirmar mesmo assim</Button><Button size="sm" variant="outline" disabled={reconcile.isPending} onClick={()=>setDecision({date:r.date,decision:'ajustar'})}>Ajustar simulação</Button></div>}</TableCell></>}</TableRow>;
      })}
      {!anticipatedDaily(payments).length && <TableRow><TableCell colSpan={allowed?7:3} className="text-center text-muted-foreground">Nenhum recebimento antecipado.</TableCell></TableRow>}
    </TableBody></Table></div>
    <Dialog open={!!decision} onOpenChange={v=>!v&&setDecision(null)}><DialogContent><DialogHeader><DialogTitle>{decision?.decision==='ajustar'?'Ajustar as simulações ao líquido do relatório?':'Confirmar apesar da diferença de valor?'}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{decision?.decision==='ajustar'?'Os líquidos serão rateados entre as simulações do dia e os descontos serão atualizados.':'Os valores digitados serão preservados; o valor real ficará registrado na confirmação.'}</p><DialogFooter><Button variant="ghost" onClick={()=>setDecision(null)}>Cancelar</Button><Button disabled={reconcile.isPending} onClick={()=>{if(decision) reconcile.mutate({hotel:hotelId,...decision},{onSuccess:n=>{if(n>0){toast.success(`${n} simulação(ões) confirmada(s)`);setDecision(null);}else toast.error('Nenhuma simulação foi confirmada; atualize os dados.');},onError:e=>toast.error(e.message)});}}>Confirmar</Button></DialogFooter></DialogContent></Dialog>
  </>;
}