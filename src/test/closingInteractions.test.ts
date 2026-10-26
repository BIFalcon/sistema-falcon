import { describe, expect, it } from 'vitest';
import { calendarDays, formatInteractionDate, intervalValue, recentPeriods, summary, type ClosingInteraction } from '@/lib/closingInteractions';
const row: ClosingInteraction={hotel_id:'itaperuna',hotel:'Ibis budget Itaperuna',is_historical:false,t_prev:'2026-09-22T16:47:00-03:00',t_gg:'2026-09-23T17:51:00-03:00',t_gop:'2026-10-13T18:39:00-03:00',t_fer:'2026-10-19T22:29:00-03:00',tipo_gop:'Comentário',tipo_fer:'Aprovação',h_prev_gg:26,h_gg_gop:337,h_gop_fer:100,h_total:462,ultimo_marco:null,h_desde_ultimo:null,gg_antes_previa:false,gg_depois_gop:false};
describe('primeiras interações DRE',()=>{
  it('preserva os quatro tempos úteis de Itaperuna informados pela RPC',()=>{
    expect(['h_prev_gg','h_gg_gop','h_gop_fer','h_total'].map(k=>intervalValue(row,k as 'h_total','business'))).toEqual([26,337,100,462]);
  });
  it('dias corridos incluem sábados e domingos',()=>{expect(calendarDays(row.t_prev,row.t_fer)).toBeCloseTo(27.2375,4);});
  it('não calcula intervalo com ponta ausente',()=>{expect(intervalValue({...row,t_gg:null},'h_prev_gg','business')).toBeNull();});
  it('não calcula intervalo com fim anterior',()=>{expect(intervalValue({...row,t_gg:row.t_prev,t_prev:row.t_fer},'h_prev_gg','business')).toBeNull();});
  it('não calcula intervalo com pontas iguais',()=>{expect(intervalValue({...row,t_gg:row.t_prev},'h_prev_gg','business')).toBeNull();});
  it('média aritmética simples exclui pontas ausentes',()=>{expect(summary([row,{...row,h_prev_gg:52},{...row,t_gg:null}],'h_prev_gg','business')).toEqual({mean:39,median:39,n:2});});
  it('hotéis sem prévia não entram em nenhuma média',()=>{expect(summary([{...row,t_prev:null}],'h_gop_fer','business')).toEqual({mean:null,median:null,n:0});});
  it('GG depois do GOP mantém prévia→GG válido sem inventar GG→GOP',()=>{const anomaly={...row,t_gg:'2026-10-14T17:51:00-03:00',h_prev_gg:300,gg_depois_gop:true};expect(intervalValue(anomaly,'h_prev_gg','business')).toBe(300);expect(intervalValue(anomaly,'h_gg_gop','business')).toBeNull();});
  it('mostra mediana sem ponderação e sem alterar linhas',()=>{expect(summary([row,{...row,h_prev_gg:10},{...row,h_prev_gg:1000}],'h_prev_gg','business').median).toBe(26);});
  it('datas usam São Paulo independentemente do fuso do navegador',()=>{expect(formatInteractionDate('2026-09-22T19:47:00Z',true)).toBe('22/09/2026 16:47');});
  it('três meses atravessam o ano',()=>{expect(recentPeriods(1,2026)).toEqual([{month:11,year:2025},{month:12,year:2025},{month:1,year:2026}]);});
});