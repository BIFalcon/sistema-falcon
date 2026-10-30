CREATE TABLE public.conc_agency_pix_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  match_id uuid NOT NULL REFERENCES public.conc_matches(id) ON DELETE CASCADE,
  bank_entry_id uuid NOT NULL REFERENCES public.conc_bank_entries(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.ar_to_invoice_entries(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id)
);
CREATE INDEX conc_agency_pix_links_bank_idx ON public.conc_agency_pix_links(bank_entry_id);
GRANT SELECT ON public.conc_agency_pix_links TO authenticated;
GRANT ALL ON public.conc_agency_pix_links TO service_role;
ALTER TABLE public.conc_agency_pix_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency pix links read" ON public.conc_agency_pix_links FOR SELECT TO authenticated
  USING (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(), hotel_id));

-- Pix de agência sem conciliação + faturas abertas da mesma agência (sugestão; nada é gravado)
CREATE OR REPLACE FUNCTION public.conc_agency_pix_suggestions(p_hotel text, p_agency text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ DECLARE a text := upper(public.unaccent_safe(btrim(coalesce(p_agency,''))));
BEGIN
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão';END IF;
IF length(a) < 3 THEN RAISE EXCEPTION 'Informe o nome da agência';END IF;
RETURN jsonb_build_object(
 'pix', coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'date',b.line_date,'description',b.description,'amount',b.amount,'cpf_cnpj',b.cpf_cnpj) ORDER BY b.line_date, b.amount)
   FROM public.conc_bank_entries b WHERE b.hotel_id=p_hotel AND b.amount>0 AND b.matched_at IS NULL AND NOT b.billing_pix
   AND upper(public.unaccent_safe(b.description)) LIKE '%PIX%' AND upper(public.unaccent_safe(b.description)) LIKE '%'||a||'%'),'[]'::jsonb),
 'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'invoice_number',e.invoice_number,'account_name',e.account_name,'confirmation_number',e.confirmation_number,'transaction_date',e.transaction_date,'departure_date',e.departure_date,'open',coalesce(e.ar_open,e.amount),'due_date',coalesce(e.boleto_due_date,e.estimated_due_date)) ORDER BY e.transaction_date, e.invoice_number)
   FROM public.ar_to_invoice_entries e WHERE e.hotel_id=p_hotel AND NOT e.is_paid AND NOT e.is_not_billable AND e.gg_status NOT IN ('pago','nao_faturavel')
   AND coalesce(e.ar_open,e.amount,0)>0 AND upper(public.unaccent_safe(coalesce(e.account_name,''))) LIKE '%'||a||'%'
   AND NOT EXISTS(SELECT 1 FROM public.conc_agency_pix_links l WHERE l.invoice_id=e.id)),'[]'::jsonb));
END $$;

-- Aprovação pelo operador: soma exata, mesmo hotel, faturas abertas; grava lineage e marca pago
CREATE OR REPLACE FUNCTION public.conc_agency_pix_confirm(p_bank_id uuid, p_invoice_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ DECLARE b record; tot numeric; n int; mid uuid; nums text;
BEGIN
SELECT * INTO b FROM public.conc_bank_entries WHERE id=p_bank_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Crédito não encontrado';END IF;
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),b.hotel_id) THEN RAISE EXCEPTION 'Sem permissão';END IF;
IF b.matched_at IS NOT NULL OR b.amount<=0 THEN RAISE EXCEPTION 'Este Pix já foi conciliado';END IF;
IF coalesce(array_length(p_invoice_ids,1),0)=0 THEN RAISE EXCEPTION 'Selecione ao menos uma fatura';END IF;
PERFORM 1 FROM public.ar_to_invoice_entries WHERE id=ANY(p_invoice_ids) FOR UPDATE;
SELECT count(*), round(sum(coalesce(ar_open,amount)),2), string_agg(coalesce(invoice_number,'—'),', ' ORDER BY invoice_number) INTO n,tot,nums
 FROM public.ar_to_invoice_entries e WHERE id=ANY(p_invoice_ids) AND hotel_id=b.hotel_id AND NOT is_paid AND NOT is_not_billable
 AND NOT EXISTS(SELECT 1 FROM public.conc_agency_pix_links l WHERE l.invoice_id=e.id);
IF n<>(SELECT count(DISTINCT x) FROM unnest(p_invoice_ids) x) THEN RAISE EXCEPTION 'Alguma fatura não está mais aberta neste hotel';END IF;
IF tot<>round(b.amount,2) THEN RAISE EXCEPTION 'Soma das faturas (R$ %) difere do Pix (R$ %)',tot,b.amount;END IF;
INSERT INTO public.conc_matches(hotel_id,kind,left_total,right_total,difference,note,matched_by)
 VALUES(b.hotel_id,'baixa_bancaria',b.amount,tot,0,'Pix de agência vinculado manualmente às faturas '||nums,auth.uid()) RETURNING id INTO mid;
INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) VALUES(mid,'bank',b.id,b.amount);
INSERT INTO public.conc_agency_pix_links(hotel_id,match_id,bank_entry_id,invoice_id,amount,created_by)
 SELECT b.hotel_id,mid,b.id,e.id,coalesce(e.ar_open,e.amount),auth.uid() FROM public.ar_to_invoice_entries e WHERE e.id=ANY(p_invoice_ids);
UPDATE public.ar_to_invoice_entries SET is_paid=true, paid_at=now(), paid_date=b.line_date, gg_status='pago',
 paid_note='Pix '||to_char(b.line_date,'DD/MM/YYYY')||' — '||coalesce(b.description,'') WHERE id=ANY(p_invoice_ids);
UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b.id;
RETURN mid;
END $$;

-- Desfazer a conciliação reabre as faturas pagas por este vínculo
CREATE OR REPLACE FUNCTION public.conc_agency_pix_unlink()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ BEGIN
UPDATE public.ar_to_invoice_entries SET is_paid=false, paid_at=NULL, paid_date=NULL, paid_note=NULL, gg_status='faturado'
 WHERE id=OLD.invoice_id AND is_paid AND paid_note LIKE 'Pix %';
RETURN OLD; END $$;
CREATE TRIGGER conc_agency_pix_unlink AFTER DELETE ON public.conc_agency_pix_links FOR EACH ROW EXECUTE FUNCTION public.conc_agency_pix_unlink();

REVOKE ALL ON FUNCTION public.conc_agency_pix_suggestions(text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.conc_agency_pix_confirm(uuid,uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.conc_agency_pix_suggestions(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conc_agency_pix_confirm(uuid,uuid[]) TO authenticated;