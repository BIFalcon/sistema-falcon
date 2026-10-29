import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AnticipationSimulation } from '@/lib/anticipationSimulation';

export function useAnticipationSimulations(hotelId: string | null, enabled: boolean) {
  return useQuery({ queryKey: ['ap-simulations', hotelId], enabled: !!hotelId && enabled, queryFn: async () => {
    if (!hotelId) return [];
    const rows: AnticipationSimulation[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('ap_anticipation').select('id,hotel_id,data_antecipacao,anticipated_amount,valor_descontado,valor_liquido,status,created_by,rede_reference').eq('hotel_id',hotelId).not('status','is',null).order('data_antecipacao',{ascending:false}).order('id').range(start,start+999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }});
}
export function useSimulationActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({queryKey:['ap-simulations']});
    qc.invalidateQueries({queryKey:['ap-anticipation-list']});
  };
  const save = useMutation({mutationFn: async (p: {hotel: string; date: string; gross: number; discount: number; net: number; id?: string}) => {
    const {data,error} = await supabase.rpc('ap_save_simulation',{p_hotel:p.hotel,p_date:p.date,p_gross:p.gross,p_discount:p.discount,p_net:p.net,p_id:p.id});
    if (error) throw error; return data;
  },onSuccess:invalidate});
  const remove = useMutation({mutationFn: async(id:string) => {
    const {error} = await supabase.rpc('ap_delete_simulation',{p_id:id}); if(error) throw error;
  },onSuccess:invalidate});
  const reconcile = useMutation({mutationFn: async(p:{hotel:string;date?:string;decision?:'auto'|'confirmar'|'ajustar'}) => {
    const {data,error} = await supabase.rpc('ap_reconcile_simulations',{p_hotel:p.hotel,p_date:p.date,p_decision:p.decision ?? 'auto'});
    if(error) throw error; return data;
  },onSuccess:invalidate});
  return {save,remove,reconcile};
}