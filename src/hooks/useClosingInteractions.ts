import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ClosingInteraction } from '@/lib/closingInteractions';

export function useClosingPeriods() {
  return useQuery({ queryKey:['closing-interaction-periods'], staleTime:300000, refetchOnWindowFocus:false,
    queryFn: async () => {
      const {data,error} = await supabase.from('closings').select('month,year').order('year',{ascending:false}).order('month',{ascending:false});
      if(error) throw error;
      const now = new Date();
      const current = Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(now))*12 + Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',month:'numeric'}).format(now));
      return (data ?? []).filter((p,i,all)=>p.year*12+p.month<=current && all.findIndex(x=>x.month===p.month&&x.year===p.year)===i);
    },
  });
}
export function useClosingInteractions(periods: {month:number;year:number}[], enabled: boolean) {
  return useQueries({queries:periods.map(p=>({queryKey:['closing-interactions',p.year,p.month], enabled, staleTime:300000, refetchOnWindowFocus:false, retry:false,
    queryFn: async (): Promise<ClosingInteraction[]> => {
      const {data,error} = await supabase.rpc('get_closing_interactions',{p_month:p.month,p_year:p.year});
      if(error) throw error;
      return (data ?? []) as ClosingInteraction[];
    },
  }))});
}