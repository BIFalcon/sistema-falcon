-- ============================================================
-- CONTAS A RECEBER — A Faturar + Open Folio
-- ============================================================

-- 1) Mapeamento Opera Cloud → hotel
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS opera_property_name text;

CREATE UNIQUE INDEX IF NOT EXISTS hotels_opera_property_name_key
  ON public.hotels (lower(opera_property_name))
  WHERE opera_property_name IS NOT NULL;

-- 2) Novo evento de notificação
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'open_folio_pendencies_to_gg';

-- 3) Helper: AR manager (financeiro / master)
CREATE OR REPLACE FUNCTION public.is_ar_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_master(_user_id) OR public.has_role(_user_id, 'financeiro');
$$;

-- 4) Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('accounts-receivable', 'accounts-receivable', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ar_storage_read_authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'accounts-receivable' AND public.has_any_role(auth.uid()));

CREATE POLICY "ar_storage_write_managers"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'accounts-receivable' AND public.is_ar_manager(auth.uid()));

CREATE POLICY "ar_storage_update_managers"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'accounts-receivable' AND public.is_ar_manager(auth.uid()));

CREATE POLICY "ar_storage_delete_managers"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'accounts-receivable' AND public.is_ar_manager(auth.uid()));

-- 5) Uploads (multi-hotel — sem hotel_id)
CREATE TABLE public.ar_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('to_invoice', 'open_folio')),
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  parsed_rows_count integer,
  unmapped_properties jsonb NOT NULL DEFAULT '[]'::jsonb,
  parse_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ar_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_uploads_select_any_role" ON public.ar_uploads
FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));

CREATE POLICY "ar_uploads_insert_managers" ON public.ar_uploads
FOR INSERT TO authenticated
WITH CHECK (public.is_ar_manager(auth.uid()) AND uploaded_by = auth.uid());

CREATE POLICY "ar_uploads_delete_managers" ON public.ar_uploads
FOR DELETE TO authenticated USING (public.is_ar_manager(auth.uid()));

CREATE INDEX ar_uploads_kind_idx ON public.ar_uploads (kind, uploaded_at DESC);

-- 6) A Faturar (acumulativo) — chave única por linha do Opera
CREATE TABLE public.ar_to_invoice_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.ar_uploads(id) ON DELETE CASCADE,
  hotel_id text REFERENCES public.hotels(id),
  property_name_raw text NOT NULL,
  account_number text,
  account_name text,
  account_type text,
  invoice_number text,
  invoice_status text,
  transaction_date date,
  original_amount numeric,
  amount numeric,
  paid numeric,
  ar_open numeric,
  confirmation_number text,
  reservation_status text,
  departure_date date,
  entry_key text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_key)
);

ALTER TABLE public.ar_to_invoice_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_ti_select_scoped" ON public.ar_to_invoice_entries
FOR SELECT TO authenticated USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro')
  OR public.has_role(auth.uid(), 'controladoria')
  OR (hotel_id IS NOT NULL AND public.is_hotel_allowed(auth.uid(), hotel_id))
);

CREATE POLICY "ar_ti_insert_managers" ON public.ar_to_invoice_entries
FOR INSERT TO authenticated WITH CHECK (public.is_ar_manager(auth.uid()));

CREATE POLICY "ar_ti_update_managers" ON public.ar_to_invoice_entries
FOR UPDATE TO authenticated
USING (public.is_ar_manager(auth.uid()))
WITH CHECK (public.is_ar_manager(auth.uid()));

CREATE POLICY "ar_ti_delete_managers" ON public.ar_to_invoice_entries
FOR DELETE TO authenticated USING (public.is_ar_manager(auth.uid()));

CREATE INDEX ar_ti_hotel_date_idx ON public.ar_to_invoice_entries (hotel_id, transaction_date);
CREATE INDEX ar_ti_account_idx ON public.ar_to_invoice_entries (hotel_id, account_number, account_name);

-- 7) Open Folio (substitui a cada upload)
CREATE TABLE public.ar_open_folio_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.ar_uploads(id) ON DELETE CASCADE,
  hotel_id text REFERENCES public.hotels(id),
  property_name_raw text NOT NULL,
  confirmation_number text,
  reservation_status text,
  first_name text,
  last_name text,
  balance numeric,
  arrival_date date,
  departure_date date,
  extraction_date date,
  days_open integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ar_open_folio_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_of_select_scoped" ON public.ar_open_folio_entries
FOR SELECT TO authenticated USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro')
  OR public.has_role(auth.uid(), 'controladoria')
  OR (hotel_id IS NOT NULL AND public.is_hotel_allowed(auth.uid(), hotel_id))
);

CREATE POLICY "ar_of_insert_managers" ON public.ar_open_folio_entries
FOR INSERT TO authenticated WITH CHECK (public.is_ar_manager(auth.uid()));

CREATE POLICY "ar_of_delete_managers" ON public.ar_open_folio_entries
FOR DELETE TO authenticated USING (public.is_ar_manager(auth.uid()));

CREATE INDEX ar_of_hotel_idx ON public.ar_open_folio_entries (hotel_id);
CREATE INDEX ar_of_balance_idx ON public.ar_open_folio_entries (balance);

-- 8) Justificativas Open Folio (por confirmation_number + hotel)
CREATE TABLE public.ar_open_folio_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  confirmation_number text NOT NULL,
  note text NOT NULL,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ar_ofn_hotel_conf_idx ON public.ar_open_folio_notes (hotel_id, confirmation_number, created_at DESC);

ALTER TABLE public.ar_open_folio_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_ofn_select_scoped" ON public.ar_open_folio_notes
FOR SELECT TO authenticated USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro')
  OR public.has_role(auth.uid(), 'controladoria')
  OR public.is_hotel_allowed(auth.uid(), hotel_id)
);

CREATE POLICY "ar_ofn_insert_scoped" ON public.ar_open_folio_notes
FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid()
  AND (
    public.is_ar_manager(auth.uid())
    OR (public.has_role(auth.uid(), 'gg') AND public.is_hotel_allowed(auth.uid(), hotel_id))
  )
);

CREATE POLICY "ar_ofn_update_own_or_managers" ON public.ar_open_folio_notes
FOR UPDATE TO authenticated USING (
  public.is_ar_manager(auth.uid()) OR author_id = auth.uid()
);

CREATE POLICY "ar_ofn_delete_managers" ON public.ar_open_folio_notes
FOR DELETE TO authenticated USING (public.is_ar_manager(auth.uid()));

CREATE TRIGGER ar_ofn_touch
BEFORE UPDATE ON public.ar_open_folio_notes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 9) Contratos por cliente (prazo de recebimento)
CREATE TABLE public.ar_client_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  account_number text,
  account_name text,
  payment_term_days integer NOT NULL CHECK (payment_term_days >= 0),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (account_number IS NOT NULL OR account_name IS NOT NULL)
);

CREATE UNIQUE INDEX ar_contracts_hotel_acctnum_idx
  ON public.ar_client_contracts (hotel_id, account_number)
  WHERE account_number IS NOT NULL;

CREATE UNIQUE INDEX ar_contracts_hotel_acctname_idx
  ON public.ar_client_contracts (hotel_id, lower(account_name))
  WHERE account_number IS NULL AND account_name IS NOT NULL;

ALTER TABLE public.ar_client_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_contracts_select_scoped" ON public.ar_client_contracts
FOR SELECT TO authenticated USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro')
  OR public.has_role(auth.uid(), 'controladoria')
  OR public.is_hotel_allowed(auth.uid(), hotel_id)
);

CREATE POLICY "ar_contracts_insert_scoped" ON public.ar_client_contracts
FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid()
  AND (
    public.is_ar_manager(auth.uid())
    OR (public.has_role(auth.uid(), 'gg') AND public.is_hotel_allowed(auth.uid(), hotel_id))
  )
);

CREATE POLICY "ar_contracts_update_scoped" ON public.ar_client_contracts
FOR UPDATE TO authenticated USING (
  public.is_ar_manager(auth.uid())
  OR (public.has_role(auth.uid(), 'gg') AND public.is_hotel_allowed(auth.uid(), hotel_id))
);

CREATE POLICY "ar_contracts_delete_scoped" ON public.ar_client_contracts
FOR DELETE TO authenticated USING (
  public.is_ar_manager(auth.uid())
  OR (public.has_role(auth.uid(), 'gg') AND public.is_hotel_allowed(auth.uid(), hotel_id))
);

CREATE TRIGGER ar_contracts_touch
BEFORE UPDATE ON public.ar_client_contracts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();