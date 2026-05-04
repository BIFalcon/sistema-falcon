
-- 1) Sub-role do financeiro em profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='financeiro_subrole'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN financeiro_subrole text NULL
      CHECK (financeiro_subrole IS NULL OR financeiro_subrole IN ('equipe','coordenadora'));
  END IF;
END $$;

-- Default: usuários atuais com role 'financeiro' viram coordenadora
UPDATE public.profiles p
SET financeiro_subrole = 'coordenadora'
WHERE p.financeiro_subrole IS NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.user_id AND ur.role = 'financeiro'
  );

-- Helpers
CREATE OR REPLACE FUNCTION public.get_financeiro_subrole(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT financeiro_subrole FROM public.profiles WHERE user_id = _user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_financeiro_equipe(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'financeiro') AND
         COALESCE(public.get_financeiro_subrole(_user_id), 'coordenadora') = 'equipe';
$$;

CREATE OR REPLACE FUNCTION public.is_financeiro_coordenadora(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'financeiro') AND
         COALESCE(public.get_financeiro_subrole(_user_id), 'coordenadora') = 'coordenadora';
$$;

-- 2) Enum de status de pagamento
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ap_payment_status') THEN
    CREATE TYPE public.ap_payment_status AS ENUM ('pendente','inserido','agendado','pago');
  END IF;
END $$;

-- 3) Colunas em ap_entries
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ap_entries' AND column_name='payment_status') THEN
    ALTER TABLE public.ap_entries ADD COLUMN payment_status public.ap_payment_status NOT NULL DEFAULT 'pendente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ap_entries' AND column_name='payment_marked_by') THEN
    ALTER TABLE public.ap_entries ADD COLUMN payment_marked_by uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ap_entries' AND column_name='payment_marked_at') THEN
    ALTER TABLE public.ap_entries ADD COLUMN payment_marked_at timestamptz NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ap_entries' AND column_name='payment_paid_at') THEN
    ALTER TABLE public.ap_entries ADD COLUMN payment_paid_at timestamptz NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ap_entries_payment_status ON public.ap_entries(hotel_id, payment_status);

-- 4) Trigger: apenas coordenadora ou master pode marcar 'pago'
CREATE OR REPLACE FUNCTION public.enforce_ap_payment_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'pago' THEN
      IF NOT (public.is_master(v_uid) OR public.is_financeiro_coordenadora(v_uid)) THEN
        RAISE EXCEPTION 'Apenas coordenadoria do financeiro pode marcar como Pago';
      END IF;
      NEW.payment_paid_at := COALESCE(NEW.payment_paid_at, now());
    END IF;
    NEW.payment_marked_by := v_uid;
    NEW.payment_marked_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ap_payment_status ON public.ap_entries;
CREATE TRIGGER trg_enforce_ap_payment_status
BEFORE UPDATE ON public.ap_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_ap_payment_status_change();
