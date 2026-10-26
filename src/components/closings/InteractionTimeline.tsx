import type { CSSProperties, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { INTERVALS, calendarDays, formatDuration, formatInteractionDate, intervalReason, intervalValue, quartile, type ClosingInteraction, type IntervalKey, type TimeUnit } from '@/lib/closingInteractions';

export function Hint({ text, children }: {text:string;children:ReactNode}) {
  return <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="inline-flex min-w-0">{children}</span></TooltipTrigger><TooltipContent className="max-w-xs">{text}</TooltipContent></Tooltip>;
}
export function Duration({row,interval,unit}:{row:ClosingInteraction;interval:IntervalKey;unit:TimeUnit}) {
  const value=intervalValue(row,interval,unit);
  return <Hint text={value==null?intervalReason(row,interval):formatDuration(intervalValue(row,interval,unit==='business'?'calendar':'business'),unit==='business'?'calendar':'business')}>{formatDuration(value,unit)}</Hint>;
}
const milestones = [
  {key:'t_prev',label:'1ª prévia'}, {key:'t_gg',label:'1º comentário do GG'},
  {key:'t_gop',label:'1ª interação do GOP'}, {key:'t_fer',label:'1ª interação do Fernando'},
] as const;
export function InteractionDates({row,full=false}:{row:ClosingInteraction;full?:boolean}) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">{milestones.map((m,i)=><div key={m.key} className="min-w-0"><div className="text-xs leading-5 text-muted-foreground">{m.label}</div><div className="text-xs font-medium leading-5">{row[m.key]?formatInteractionDate(row[m.key],full):i===1?'sem comentário':'sem registro'}</div>{i>1&&<div className="text-xs text-muted-foreground">{i===2?row.tipo_gop:row.tipo_fer}</div>}</div>)}</div>;
}
export function HotelHeading({row}:{row:ClosingInteraction}) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="min-w-0 text-sm font-semibold leading-6">{row.hotel}</h3>{row.is_historical&&<Badge variant="outline">Histórico</Badge>}{(row.gg_antes_previa||row.gg_depois_gop)&&<Hint text={[row.gg_antes_previa?'O comentário do GG é anterior à primeira prévia':'',row.gg_depois_gop?'O GG comentou depois do GOP; o intervalo GG→GOP não é calculado':''].filter(Boolean).join('. ')}><Badge variant="outline" className="text-warning" aria-label="Anomalia">!</Badge></Hint>}</div>;
}
export default function InteractionTimeline({row,rows,unit,scale,ongoing}:{row:ClosingInteraction;rows:ClosingInteraction[];unit:TimeUnit;scale:number;ongoing:boolean}) {
  const other=unit==='business'?'calendar':'business';
  const elapsed=(date:string|null) => {
    if (!date||!row.t_prev) return 0;
    // Use the same shared month scale; calendar positions preserve the chronological order even for anomalies.
    return Math.max(0, (Date.parse(date)-Date.parse(row.t_prev))/3600000);
  };
  const pos=(date:string|null)=>Math.min(100,elapsed(date)/Math.max(scale,1)*96);
  const registered=milestones.map((m,i)=>({m,i,date:row[m.key]})).filter(e=>e.date);
  const last=registered.reduce((a,e)=>Math.max(a,pos(e.date)),0);
  const latest=[row.t_prev,row.t_gg,row.t_gop].filter((d):d is string=>!!d).sort().at(-1)??null;
  const waiting=unit==='business'?row.h_desde_ultimo:calendarDays(latest,new Date().toISOString());
  return <article className="rounded-md border bg-card p-4 sm:p-5" data-hotel={row.hotel}>
    <div className="flex items-start justify-between gap-3"><HotelHeading row={row}/><div className="shrink-0 text-right"><div className="text-xs text-muted-foreground">Total</div><div className="text-lg font-bold"><Duration row={row} interval="h_total" unit={unit}/></div><div className="text-xs text-muted-foreground">{formatDuration(intervalValue(row,'h_total',other),other)}</div></div></div>
    <div className="interaction-ruler" aria-label={`Primeiras interações de ${row.hotel}`}>
      {registered.slice(1).map((e,j)=>{const prev=registered[j];if(!prev)return null;const left=pos(prev.date),right=pos(e.date);const interval=INTERVALS[e.i-1];const values=interval?rows.filter(r=>r.t_prev).map(r=>intervalValue(r,interval.key,'business')).filter((v):v is number=>v!=null):[];const q=interval?quartile(intervalValue(row,interval.key,'business'),values):0;return <span key={e.m.key} className={`interaction-segment interaction-segment-${q}`} style={{left:`${Math.min(left,right)}%`,width:`${Math.abs(right-left)}%`} as CSSProperties}/>;})}
      {!row.t_fer&&<span className="absolute top-[23px] h-px border-t border-dashed border-warning" style={{left:`${last}%`,width:`${100-last}%`}}/>}
      {registered.map(e=><span key={e.m.key} title={`${e.m.label}: ${formatInteractionDate(e.date,true)}`} aria-label={`${e.m.label}: ${formatInteractionDate(e.date,true)}`} className={`interaction-marker ${e.i===0?'interaction-marker-preview':(e.i===2?row.tipo_gop:e.i===3?row.tipo_fer:null)==='Aprovação'?'interaction-marker-approval':''}`} style={{left:`${pos(e.date)}%`}}/>)}
      {!row.t_fer&&<span className="interaction-marker interaction-marker-missing" style={{left:'100%'}}/>}
    </div>
    {!row.t_fer&&<p className="mb-3 text-xs text-warning">{ongoing&&row.ultimo_marco&&waiting!=null?`Após ${row.ultimo_marco}: aguardando há ${formatDuration(waiting,unit)}`:'sem registro'}</p>}
    <div className="mb-4 grid grid-cols-4 divide-x rounded-md bg-muted/50 py-3" aria-label="Tempos">{INTERVALS.map(i=><div key={i.key} className="min-w-0 px-1 text-center sm:px-3"><div className="break-words text-[10px] leading-4 text-muted-foreground sm:text-xs">{i.label}</div><div className={`mt-1 text-sm tabular-nums sm:text-base ${i.key==='h_total'?'font-bold':'font-medium'}`}><Duration row={row} interval={i.key} unit={unit}/></div></div>)}</div>
    <InteractionDates row={row}/>
  </article>;
}