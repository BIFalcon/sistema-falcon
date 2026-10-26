import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LabelList, ResponsiveContainer } from 'recharts';
import { INTERVALS, formatDuration, summary, type ClosingInteraction, type TimeUnit } from '@/lib/closingInteractions';
import { MONTHS_PT } from '@/lib/constants';

export default function InteractionChart({periods,rows,unit,ongoing}:{periods:{month:number;year:number}[];rows:ClosingInteraction[][];unit:TimeUnit;ongoing:boolean}) {
  const data=INTERVALS.map(i=>({label:i.label,...Object.fromEntries(periods.map((_,j)=>[`m${j}`,summary(rows[j]??[],i.key,unit).mean]))}));
  const maximum=Math.max(1,...data.flatMap(d=>periods.map((_,j)=>Number((d as Record<string,unknown>)[`m${j}`])||0)));
  const magnitude=10**Math.floor(Math.log10(maximum/4));
  const step=Math.ceil(maximum/4/magnitude)*magnitude;
  const totals=periods.map((p,j)=>`${formatDuration(summary(rows[j]??[],'h_total',unit).mean,unit)} em ${MONTHS_PT[p.month-1]?.toLowerCase()}`);
  return <section className="min-w-0 space-y-4 border-t pt-6"><h2 className="text-lg font-semibold">Média do tempo em todas as etapas</h2>
    <div className="max-w-full overflow-x-auto"><div className="h-80 min-w-[620px]">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{top:28,right:16,left:0,bottom:12}} barGap={5}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))"/>
        <XAxis dataKey="label" tick={{fill:'hsl(var(--muted-foreground))',fontSize:11}} axisLine={false} tickLine={false}/>
        <YAxis domain={[0,step*4]} ticks={[0,step,step*2,step*3,step*4]} tickFormatter={v=>formatDuration(v,unit)} tick={{fill:'hsl(var(--muted-foreground))',fontSize:11}} axisLine={false} tickLine={false}/>
        <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;const interval=INTERVALS.find(i=>i.label===label);if(!interval)return null;const other=unit==='business'?'calendar':'business';return <div className="space-y-2 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-sm"><div className="font-semibold">{label}</div>{periods.map((p,j)=>{const s=summary(rows[j]??[],interval.key,unit);return <div key={j}>{MONTHS_PT[p.month-1]}: média {formatDuration(s.mean,unit)} ({formatDuration(summary(rows[j]??[],interval.key,other).mean,other)}) · mediana {formatDuration(s.median,unit)} · {s.n} hotéis</div>;})}</div>;}}/>
        <Legend itemSorter="dataKey" wrapperStyle={{fontSize:11}}/>
        {periods.map((p,j)=><Bar key={j} dataKey={`m${j}`} name={`${MONTHS_PT[p.month-1]} ${p.year}`} fill={`hsl(var(--interaction-month${j+1}))`} radius={[3,3,0,0]} maxBarSize={54} isAnimationActive={false}><LabelList dataKey={`m${j}`} position="top" className="interaction-chart-axis" formatter={(v:unknown)=>formatDuration(typeof v==='number'?v:null,unit)}/></Bar>)}
      </BarChart></ResponsiveContainer>
    </div></div><p className="text-xs leading-6 text-muted-foreground">O tempo médio total foi de {totals.join(', ')}.{ongoing?` ${MONTHS_PT[periods[2]?.month-1]?.toLowerCase()} ainda está em andamento.`:''}</p>
  </section>;
}