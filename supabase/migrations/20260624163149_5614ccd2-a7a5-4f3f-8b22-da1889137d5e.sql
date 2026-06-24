-- 1) Adiciona o status "quitado" ao enum de pagamento.
ALTER TYPE public.ap_payment_status ADD VALUE IF NOT EXISTS 'quitado';

-- 2) Colunas de quitação.
ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS settled_by uuid;

-- 3) Atualiza o trigger de mudança de status:
--   - manter regras de "pago" (apenas master/patronos).
--   - "quitado" só pode vir após "pago"/"pago_parcialmente"; permitido para
--     master, controladoria (incl. equipe) e patronos.
CREATE OR REPLACE FUNCTION public.enforce_ap_payment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'pago' THEN
      IF NOT (public.is_master(v_uid) OR public.is_patronos(v_uid)) THEN
        RAISE EXCEPTION 'Apenas patronos pode marcar como Pago';
      END IF;
      NEW.payment_paid_at := COALESCE(NEW.payment_paid_at, now());
    ELSIF NEW.payment_status = 'quitado' THEN
      IF NOT (
        public.is_master(v_uid)
        OR public.is_patronos(v_uid)
        OR public.has_role(v_uid, 'controladoria'::public.app_role)
      ) THEN
        RAISE EXCEPTION 'Apenas controladoria/patronos podem marcar como Quitado';
      END IF;
      IF OLD.payment_status NOT IN ('pago','pago_parcialmente','quitado') THEN
        RAISE EXCEPTION 'Só é possível quitar um pagamento já marcado como Pago';
      END IF;
      NEW.settled_at := COALESCE(NEW.settled_at, now());
      NEW.settled_by := COALESCE(NEW.settled_by, v_uid);
      -- preserva data de pagamento já registrada
      NEW.payment_paid_at := COALESCE(NEW.payment_paid_at, OLD.payment_paid_at);
    END IF;
    NEW.payment_marked_by := v_uid;
    NEW.payment_marked_at := now();
  END IF;
  RETURN NEW;
END;
$function$;