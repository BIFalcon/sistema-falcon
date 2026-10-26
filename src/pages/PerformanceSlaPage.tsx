import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useClosingInteractions, useClosingPeriods } from '@/hooks/useClosingInteractions';
import { INTERVALS, formatDuration, formatInteractionDate, intervalValue, recentPeriods, summary, type ClosingInteraction, type IntervalKey, type TimeUnit } from '@/lib/closingInteractions';
import { MONTHS_PT } from '@/lib/constants';
import InteractionTimeline, { Duration, Hint, HotelHeading, InteractionDates } from '@/components/closings/InteractionTimeline';
import InteractionChart from '@/components/closings/InteractionChart';

type SortKey = 'hotel' | 't_prev' | 't_gg' | 't_gop' | 't_fer' | IntervalKey;
export default function PerformanceSlaPage() {
  const available = useClosingPeriods();
  const [selection,setSelection]=useState<{month:number;year:number}|null>(null);
  const [unit,setUnit]=useState<TimeUnit>('business');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<SortKey>('h_total');
  const [ascending,setAscending]=useState(false);
  const selected=selection??available.data?.[0];
  const periods=useMemo(()=>selected?recentPeriods(selected.month,selected.year):[],[selected?.month,selected?.year]);
  const queries=useClosingInteractions(periods,!!selected);
  const datasets=queries.map(q=>q.data??[]);
  const rows=datasets[2]??[];
  const previous=datasets[1]??[];
  const loading=available.isLoading||queries.some(q=>q.isLoading);
  const error=available.error??queries.find(q=>q.error)?.error;
  const active=rows.filter(r=>r.t_prev);
  const noFlow=rows.filter(r=>!r.t_prev);
  const ongoing=active.some(r=>!r.t_fer);
  const visible=active.filter(r=>r.hotel.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).sort((a,b)=>{
    const av=sort.startsWith('h_')?intervalValue(a,sort as IntervalKey,unit):a[sort];
    const bv=sort.startsWith('h_')?intervalValue(b,sort as IntervalKey,unit):b[sort];
    if(av==null)return bv==null?a.hotel.localeCompare(b.hotel):1;
    if(bv==null)return -1;
    const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv));
    return (ascending?1:-1)*result||a.hotel.localeCompare(b.hotel);
  });
  const scale=Math.max(1,...active.flatMap(r=>[r.t_gg,r.t_gop,r.t_fer].filter((d):d is string=>!!d).map(d=>(Date.parse(d)-Date.parse(r.t_prev??d))/3600000)));
  const gg=active.filter(r=>r.t_gg).length;
  const changeSort=(key:SortKey)=>{setAscending(sort===key?!ascending:key==='hotel');setSort(key);};
  const move=(delta:number)=>{if(!selected)return;const d=new Date(selected.year,selected.month-1+delta,1);setSelection({month:d.getMonth()+1,year:d.getFullYear()});};
  const exportExcel=()=>{
    if(!selected)return;
    const output=[...active,...noFlow].map(r=>({Hotel:r.hotel,Histórico:r.is_historical?'Sim':'Não','1ª prévia':formatInteractionDate(r.t_prev,true),'1º comentário do GG':formatInteractionDate(r.t_gg,true),'1ª interação do GOP':formatInteractionDate(r.t_gop,true),'Tipo GOP':r.tipo_gop??'','1ª interação do Fernando':formatInteractionDate(r.t_fer,true),'Tipo Fernando':r.tipo_fer??'',...Object.fromEntries(INTERVALS.flatMap(i=>[[`${i.label} (horas úteis)`,intervalValue(r,i.key,'business')??''],[`${i.label} (dias corridos)`,intervalValue(r,i.key,'calendar')==null?'':Number(intervalValue(r,i.key,'calendar')?.toFixed(1))]]))}));
    const sheet=XLSX.utils.json_to_sheet(output);sheet['!cols']=Object.keys(output[0]??{}).map((_,i)=>({wch:i===0?32:24}));
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Primeiras interações');XLSX.writeFile(book,`Performance_DRE_${selected.month}_${selected.year}.xlsx`);
  };
  const dateCols: {key:SortKey;label:string}[]=[{key:'t_prev',label:'1ª prévia'},{key:'t_gg',label:'1º comentário do GG'},{key:'t_gop',label:'1ª interação do GOP'},{key:'t_fer',label:'1ª interação do Fernando'}];
  return <TooltipProvider delayDuration={150}><div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header className="space-y-4"><div><h1 className="text-2xl font-bold tracking-normal">Performance SLA do fechamento</h1><p className="mt-1 text-sm text-muted-foreground">Tempo entre as primeiras interações da DRE</p></div>
      <div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-1"><Button size="icon" variant="outline" aria-label="Mês anterior" disabled={!selected} onClick={()=>move(-1)}><ChevronLeft/></Button>
        <Select value={selected?`${selected.year}-${selected.month}`:undefined} onValueChange={v=>{const [year,month]=v.split('-').map(Number);setSelection({year,month});}}><SelectTrigger className="w-48" aria-label="Mês de fechamento"><SelectValue placeholder="Mês de fechamento"/></SelectTrigger><SelectContent>{available.data?.map(p=><SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>{MONTHS_PT[p.month-1]} / {p.year}</SelectItem>)}{selected&&!available.data?.some(p=>p.month===selected.month&&p.year===selected.year)&&<SelectItem value={`${selected.year}-${selected.month}`}>{MONTHS_PT[selected.month-1]} / {selected.year}</SelectItem>}</SelectContent></Select>
        <Button size="icon" variant="outline" aria-label="Próximo mês" disabled={!selected} onClick={()=>move(1)}><ChevronRight/></Button></div>
        <ToggleGroup type="single" value={unit} onValueChange={v=>{if(v==='business'||v==='calendar')setUnit(v);}} variant="outline" aria-label="Unidade de tempo"><ToggleGroupItem value="business">Horas úteis</ToggleGroupItem><ToggleGroupItem value="calendar">Dias corridos</ToggleGroupItem></ToggleGroup>
        <Button variant="outline" className="sm:ml-auto" onClick={exportExcel} disabled={loading||!!error||!rows.length}><Download/>Exportar Excel</Button>
      </div>
      <p className="border-l-2 border-accent pl-3 text-xs leading-6 text-muted-foreground">Horas úteis contam 24h por dia, de segunda a sexta. Dias corridos incluem sábado e domingo. Todos os tempos partem da primeira interação de cada pessoa.</p>
    </header>
    {error?<div role="alert" className="rounded-md border border-destructive p-4 text-sm text-destructive">Não foi possível carregar as primeiras interações. <Button variant="link" onClick={()=>{void available.refetch();queries.forEach(q=>void q.refetch());}}>Tentar novamente</Button></div>:loading?<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({length:5},(_,i)=><Skeleton key={i} className="h-32"/>)}</div>:<>
      {ongoing&&<p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-6">Mês em andamento: hotéis ainda sem interação do Fernando ficam fora do Total e aparecem como aguardando.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{INTERVALS.map(i=>{const s=summary(rows,i.key,unit),p=summary(previous,i.key,unit);const variation=s.mean!=null&&p.mean!=null&&p.mean!==0?(s.mean-p.mean)/p.mean*100:null;return <Card key={i.key} className="rounded-md shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{i.label}</p><div className="mt-2 text-2xl font-bold"><Hint text={`Mediana: ${formatDuration(s.median,unit)} · ${formatDuration(summary(rows,i.key,unit==='business'?'calendar':'business').mean,unit==='business'?'calendar':'business')}`}>{formatDuration(s.mean,unit)}</Hint></div><p className="mt-1 text-xs text-muted-foreground">média de {s.n} hotéis</p>{variation!=null?<div className={`mt-3 flex items-center gap-1 text-xs ${variation<=0?'text-success':'text-destructive'}`}>{variation<=0?<ArrowDown className="h-3 w-3"/>:<ArrowUp className="h-3 w-3"/>}{Math.abs(variation).toFixed(1)}% <span className="text-muted-foreground">vs. mês anterior</span></div>:<p className="mt-3 text-xs text-muted-foreground">Sem comparação</p>}</CardContent></Card>;})}
        <Card className="col-span-2 rounded-md shadow-none lg:col-span-1"><CardContent className="p-4"><p className="text-xs text-muted-foreground">GG interagiu</p><p className="mt-2 text-2xl font-bold">{gg} <span className="text-sm font-normal text-muted-foreground">de {active.length} hotéis</span></p><progress aria-label="Hotéis com primeiro comentário do GG" value={gg} max={Math.max(1,active.length)} className="mt-4 h-2 w-full accent-primary"/></CardContent></Card>
      </div>
      <Tabs defaultValue="timeline" className="min-w-0 space-y-4"><div className="flex flex-wrap items-center gap-3"><TabsList><TabsTrigger value="timeline">Linha do tempo</TabsTrigger><TabsTrigger value="table">Tabela</TabsTrigger></TabsList><Input className="w-full sm:ml-auto sm:w-60" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filtrar por hotel" aria-label="Filtrar por hotel"/><Select value={sort==='hotel'?'hotel':'total'} onValueChange={v=>{setSort(v==='hotel'?'hotel':'h_total');setAscending(v==='hotel');}}><SelectTrigger className="w-48" aria-label="Ordenação"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="total">Total: maior primeiro</SelectItem><SelectItem value="hotel">Nome do hotel</SelectItem></SelectContent></Select></div>
        <TabsContent value="timeline" className="space-y-4">{visible.map(r=><InteractionTimeline key={r.hotel_id} row={r} rows={active} unit={unit} scale={scale} ongoing={ongoing}/>)}{!visible.length&&<p className="py-6 text-center text-sm text-muted-foreground">Nenhum hotel com fluxo de DRE para esta seleção.</p>}</TabsContent>
        <TabsContent value="table"><div className="hidden rounded-md border lg:block"><table className="w-full table-fixed text-xs"><thead><tr className="border-b bg-muted/50"><th className="w-[19%] p-2 text-left"><Button className="h-auto whitespace-normal p-0 text-xs" variant="ghost" onClick={()=>changeSort('hotel')}>Hotel {sort==='hotel'?(ascending?'↑':'↓'):''}</Button></th>{[...dateCols,...INTERVALS].map(c=><th key={c.key} className="p-2 text-left"><Button className="h-auto whitespace-normal p-0 text-left text-xs" variant="ghost" onClick={()=>changeSort(c.key)}>{c.label} {sort===c.key?(ascending?'↑':'↓'):''}</Button></th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.hotel_id} className="border-b last:border-0"><td className="break-words p-2"><HotelHeading row={r}/></td>{dateCols.map(c=><td key={c.key} className="p-2 leading-5">{formatInteractionDate(r[c.key] as string|null,true)}{c.key==='t_gop'||c.key==='t_fer'?<div className="text-muted-foreground">{c.key==='t_gop'?r.tipo_gop:r.tipo_fer}</div>:null}</td>)}{INTERVALS.map(i=><td key={i.key} className={`p-2 ${i.key==='h_total'?'font-bold':''}`}><Duration row={r} interval={i.key} unit={unit}/></td>)}</tr>)}</tbody></table></div>
          <div className="space-y-3 lg:hidden">{visible.map(r=><article key={r.hotel_id} className="space-y-4 rounded-md border bg-card p-4"><HotelHeading row={r}/><InteractionDates row={r} full/><div className="grid grid-cols-4 gap-2">{INTERVALS.map(i=><div key={i.key} className="min-w-0"><p className="break-words text-[10px] text-muted-foreground">{i.label}</p><p className="text-sm font-semibold"><Duration row={r} interval={i.key} unit={unit}/></p></div>)}</div></article>)}</div>
        </TabsContent>
      </Tabs>
      <InteractionChart periods={periods} rows={datasets} unit={unit} ongoing={ongoing}/>
      <details className="border-t py-4"><summary className="cursor-pointer text-sm font-medium">Sem fluxo de DRE neste mês ({noFlow.length})</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">{noFlow.map(r=><div key={r.hotel_id} className="rounded-md border p-3"><HotelHeading row={r}/><p className="mt-1 text-xs text-muted-foreground">Sem registro de 1ª prévia</p></div>)}</div></details>
    </>}
  </div></TooltipProvider>;
}
