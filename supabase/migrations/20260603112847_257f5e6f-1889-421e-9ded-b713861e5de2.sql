-- Permite UPDATE de ar_to_invoice_entries por usuários com role 'adm'
-- além do GG já existente. Mesma política de escopo por hotel.
DROP POLICY IF EXISTS "ar_ti_update_adm" ON public.ar_to_invoice_entries;
CREATE POLICY "ar_ti_update_adm"
ON public.ar_to_invoice_entries
FOR UPDATE TO authenticated
USING ((hotel_id IS NOT NULL)
       AND public.has_role(auth.uid(), 'adm'::app_role)
       AND public.is_hotel_allowed(auth.uid(), hotel_id))
WITH CHECK ((hotel_id IS NOT NULL)
            AND public.has_role(auth.uid(), 'adm'::app_role)
            AND public.is_hotel_allowed(auth.uid(), hotel_id));

-- Reescreve o trigger de enforcement: GG e adm podem agora atualizar
-- os campos do novo fluxo (documentos, cliente, não faturável).
CREATE OR REPLACE FUNCTION public.ar_ti_enforce_gg_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_gg boolean := public.has_role(auth.uid(), 'gg'::app_role);
  is_adm boolean := public.has_role(auth.uid(), 'adm'::app_role);
  is_manager boolean := public.is_ar_manager(auth.uid());
BEGIN
  IF NEW.gg_status IS DISTINCT FROM OLD.gg_status THEN
    NEW.gg_confirmed_by := auth.uid();
    NEW.gg_confirmed_at := now();
  END IF;

  -- Quem é só adm/gg (não é manager) só pode mexer em status, observações,
  -- cliente, arquivos de NF/boleto/comprovante e flag de não faturável.
  IF (is_gg OR is_adm) AND NOT is_manager THEN
    IF NEW.upload_id IS DISTINCT FROM OLD.upload_id
       OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
       OR NEW.property_name_raw IS DISTINCT FROM OLD.property_name_raw
       OR NEW.account_number IS DISTINCT FROM OLD.account_number
       OR NEW.account_name IS DISTINCT FROM OLD.account_name
       OR NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.invoice_status IS DISTINCT FROM OLD.invoice_status
       OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
       OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.paid IS DISTINCT FROM OLD.paid
       OR NEW.ar_open IS DISTINCT FROM OLD.ar_open
       OR NEW.confirmation_number IS DISTINCT FROM OLD.confirmation_number
       OR NEW.reservation_status IS DISTINCT FROM OLD.reservation_status
       OR NEW.departure_date IS DISTINCT FROM OLD.departure_date
       OR NEW.entry_key IS DISTINCT FROM OLD.entry_key
       OR NEW.raw IS DISTINCT FROM OLD.raw
       OR NEW.is_paid IS DISTINCT FROM OLD.is_paid
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.is_defaulting IS DISTINCT FROM OLD.is_defaulting
       OR NEW.defaulting_at IS DISTINCT FROM OLD.defaulting_at
       OR NEW.defaulting_note IS DISTINCT FROM OLD.defaulting_note
       OR NEW.billed_at IS DISTINCT FROM OLD.billed_at
       OR NEW.estimated_due_date IS DISTINCT FROM OLD.estimated_due_date
       OR NEW.documents_problem_note IS DISTINCT FROM OLD.documents_problem_note
       OR NEW.documents_problem_at IS DISTINCT FROM OLD.documents_problem_at
    THEN
      RAISE EXCEPTION 'adm/GG só podem atualizar documentos, cliente vinculado e marcação de não faturável';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;