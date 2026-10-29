ALTER TABLE public.ap_anticipation ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS confirmed_by uuid, ADD COLUMN IF NOT EXISTS rede_reference jsonb, ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.ap_anticipation ADD CONSTRAINT ap_anticipation_status_valid CHECK (status IS NULL OR status IN ('simulada','confirmada'));
CREATE INDEX ap_anticipation_simulation_day ON public.ap_anticipation(hotel_id,data_antecipacao) WHERE status IS NOT NULL;
CREATE OR REPLACE FUNCTION public.can_manage_anticipation(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT NOT public.has_role(p_user,'fernando') AND (public.is_master(p_user) OR public.has_role(p_user,'patronos') OR public.has_role(p_user,'controladoria')) $$;
DROP POLICY IF EXISTS ap_anticipation_managers_all ON public.ap_anticipation;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ap_anticipation TO authenticated;
GRANT ALL ON public.ap_anticipation TO service_role;
CREATE POLICY anticipation_read ON public.ap_anticipation FOR SELECT TO authenticated USING(public.can_manage_anticipation(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id));
CREATE POLICY anticipation_legacy_insert ON public.ap_anticipation FOR INSERT TO authenticated WITH CHECK(public.can_manage_anticipation(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id) AND status IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL AND rede_reference IS NULL AND created_by IS NULL AND informed_by = auth.uid());
CREATE POLICY anticipation_legacy_update ON public.ap_anticipation FOR UPDATE TO authenticated USING(public.can_manage_anticipation(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id) AND status IS NULL) WITH CHECK(public.can_manage_anticipation(auth.uid()) AND status IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL AND rede_reference IS NULL AND created_by IS NULL);
CREATE OR REPLACE FUNCTION public.ap_save_simulation(p_hotel text,p_date date,p_gross numeric,p_discount numeric,p_net numeric,p_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_row public.ap_anticipation;
BEGIN
 IF NOT public.can_manage_anticipation(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão para simular antecipações'; END IF;
 IF p_date IS NULL OR p_gross IS NULL OR p_discount IS NULL OR p_net IS NULL OR p_gross <= 0 OR p_discount < 0 OR p_discount >= p_gross OR p_net <= 0 OR p_net > p_gross OR p_gross::text IN ('NaN','Infinity','-Infinity') OR p_discount::text IN ('NaN','Infinity','-Infinity') OR p_net::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe data e valores válidos; líquido positivo e não maior que bruto'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('anticipation:'||p_hotel,0));
 IF p_id IS NOT NULL THEN
  SELECT * INTO v_row FROM public.ap_anticipation WHERE id=p_id AND hotel_id=p_hotel FOR UPDATE;
  IF NOT FOUND OR v_row.status IS DISTINCT FROM 'simulada' OR (v_row.created_by IS DISTINCT FROM auth.uid() AND NOT public.is_master(auth.uid())) THEN RAISE EXCEPTION 'Somente o criador ou Master pode editar uma simulação ainda não confirmada'; END IF;
  UPDATE public.ap_anticipation SET data_antecipacao=p_date,month=extract(month from p_date),year=extract(year from p_date),anticipated_amount=round(p_gross,2),valor_descontado=round(p_discount,2),valor_liquido=round(p_net,2) WHERE id=p_id RETURNING id INTO v_id;
 ELSE
  INSERT INTO public.ap_anticipation(hotel_id,month,year,data_antecipacao,anticipated_amount,valor_descontado,valor_liquido,status,created_by,informed_by) VALUES(p_hotel,extract(month from p_date),extract(year from p_date),p_date,round(p_gross,2),round(p_discount,2),round(p_net,2),'simulada',auth.uid(),auth.uid()) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.ap_delete_simulation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.ap_anticipation;
BEGIN
 SELECT * INTO v_row FROM public.ap_anticipation WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Simulação não encontrada'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('anticipation:'||v_row.hotel_id,0));
 SELECT * INTO v_row FROM public.ap_anticipation WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_anticipation(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),v_row.hotel_id) OR v_row.status IS DISTINCT FROM 'simulada' OR (v_row.created_by IS DISTINCT FROM auth.uid() AND NOT public.is_master(auth.uid())) THEN RAISE EXCEPTION 'Sem permissão para excluir esta simulação'; END IF;
 DELETE FROM public.ap_anticipation WHERE id=p_id;
END $$;
CREATE OR REPLACE FUNCTION public.ap_reconcile_simulations(p_hotel text,p_date date DEFAULT NULL,p_decision text DEFAULT 'auto') RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; v_count integer:=0; v_changed integer;
BEGIN
 IF NOT public.can_manage_anticipation(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão para confirmar antecipações'; END IF;
 IF p_decision NOT IN ('auto','confirmar','ajustar') OR (p_decision<>'auto' AND p_date IS NULL) THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('anticipation:'||p_hotel,0));
 FOR r IN
  WITH actual AS (SELECT data_recebimento AS day,round(sum(valor_liquido_parcela),2) AS net,count(*) AS entries FROM public.conc_rede_pagamentos WHERE hotel_id=p_hotel AND data_recebimento IS NOT NULL AND data_original_vencimento>data_recebimento AND valor_liquido_parcela IS NOT NULL GROUP BY data_recebimento), sims AS (SELECT data_antecipacao AS day,sum(valor_liquido) FILTER(WHERE status='simulada') AS pending_net,sum(valor_liquido) FILTER(WHERE status='confirmada') AS confirmed_net,count(*) FILTER(WHERE status='simulada') AS pending_count FROM public.ap_anticipation WHERE hotel_id=p_hotel AND status IS NOT NULL GROUP BY data_antecipacao)
  SELECT a.*,s.pending_net,coalesce(s.confirmed_net,0) AS confirmed_net FROM actual a JOIN sims s ON s.day=a.day WHERE s.pending_count>0 AND a.net>0 AND (p_date IS NULL OR a.day=p_date)
 LOOP
  IF abs(r.pending_net+r.confirmed_net-r.net)<=1 OR p_decision='confirmar' THEN
   UPDATE public.ap_anticipation SET status='confirmada',confirmed_at=now(),confirmed_by=auth.uid(),rede_reference=jsonb_build_object('date',r.day,'net',r.net,'entries',r.entries,'decision',p_decision) WHERE hotel_id=p_hotel AND data_antecipacao=r.day AND status='simulada';
   GET DIAGNOSTICS v_changed=ROW_COUNT; v_count:=v_count+v_changed;
  ELSIF p_decision='ajustar' THEN
   IF r.net-r.confirmed_net<=0 OR EXISTS(SELECT 1 FROM public.ap_anticipation WHERE hotel_id=p_hotel AND data_antecipacao=r.day AND status='simulada' AND created_by IS DISTINCT FROM auth.uid() AND NOT public.is_master(auth.uid())) THEN RAISE EXCEPTION 'Somente criador ou Master pode ajustar as simulações'; END IF;
   IF EXISTS(SELECT 1 FROM public.ap_anticipation WHERE hotel_id=p_hotel AND data_antecipacao=r.day AND status='simulada' AND round(valor_liquido/r.pending_net*(r.net-r.confirmed_net),2)>anticipated_amount) THEN RAISE EXCEPTION 'O líquido do relatório excede o bruto simulado; edite a simulação'; END IF;
   WITH split AS (SELECT id,round(valor_liquido/r.pending_net*(r.net-r.confirmed_net),2) AS net,row_number() OVER(ORDER BY id) AS n FROM public.ap_anticipation WHERE hotel_id=p_hotel AND data_antecipacao=r.day AND status='simulada'), exact AS (SELECT id,net+CASE WHEN n=1 THEN r.net-r.confirmed_net-sum(net) OVER() ELSE 0 END AS net FROM split)
   UPDATE public.ap_anticipation a SET valor_liquido=e.net,valor_descontado=a.anticipated_amount-e.net,status='confirmada',confirmed_at=now(),confirmed_by=auth.uid(),rede_reference=jsonb_build_object('date',r.day,'net',r.net,'entries',r.entries,'decision',p_decision,'previous_net',a.valor_liquido) FROM exact e WHERE a.id=e.id;
   GET DIAGNOSTICS v_changed=ROW_COUNT; v_count:=v_count+v_changed;
  END IF;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.can_manage_anticipation(uuid),public.ap_save_simulation(text,date,numeric,numeric,numeric,uuid),public.ap_delete_simulation(uuid),public.ap_reconcile_simulations(text,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_anticipation(uuid),public.ap_save_simulation(text,date,numeric,numeric,numeric,uuid),public.ap_delete_simulation(uuid),public.ap_reconcile_simulations(text,date,text) TO authenticated;
