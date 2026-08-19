CREATE OR REPLACE FUNCTION public.can_access_conciliacao(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'fernando')
      OR public.has_role(_user_id, 'patronos')
      OR public.has_role(_user_id, 'controladoria')
$$;

REVOKE ALL ON FUNCTION public.can_access_conciliacao(uuid) FROM anon;

-- 1. Tabela de referência TRX_CODE -> Categoria
CREATE TABLE public.trx_code_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trx_code text NOT NULL UNIQUE,
  descricao text,
  categoria text,
  ativo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trx_code_mapping TO authenticated;
GRANT ALL ON public.trx_code_mapping TO service_role;
ALTER TABLE public.trx_code_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc read trx map" ON public.trx_code_mapping FOR SELECT TO authenticated USING (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "conc write trx map" ON public.trx_code_mapping FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE TRIGGER trx_code_mapping_touch BEFORE UPDATE ON public.trx_code_mapping FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Uploads
CREATE TABLE public.conc_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text REFERENCES public.hotels(id),
  kind text NOT NULL CHECK (kind IN ('opera','acquirer','bank')),
  file_name text NOT NULL,
  file_size bigint,
  parsed_count integer,
  skipped_count integer,
  parse_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_uploads TO authenticated;
GRANT ALL ON public.conc_uploads TO service_role;
ALTER TABLE public.conc_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc uploads all" ON public.conc_uploads FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));

-- 3. Lançamentos do Opera
CREATE TABLE public.conc_opera_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE SET NULL,
  entry_key text NOT NULL UNIQUE,
  trx_code text NOT NULL,
  trx_desc text,
  categoria text,
  amount numeric NOT NULL DEFAULT 0,
  business_date date,
  room text,
  guest_full_name text,
  receipt_no text,
  direct_bank boolean NOT NULL DEFAULT false,
  direct_bank_by uuid,
  direct_bank_at timestamptz,
  matched_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_opera_hotel_date_idx ON public.conc_opera_entries (hotel_id, business_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_opera_entries TO authenticated;
GRANT ALL ON public.conc_opera_entries TO service_role;
ALTER TABLE public.conc_opera_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc opera all" ON public.conc_opera_entries FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));

-- 4. Vendas da operadora (adquirente)
CREATE TABLE public.conc_acquirer_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE SET NULL,
  entry_key text NOT NULL UNIQUE,
  establishment_raw text,
  sale_date date,
  amount numeric NOT NULL DEFAULT 0,
  bandeira text,
  modalidade text,
  categoria text,
  status text,
  matched_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_acquirer_hotel_date_idx ON public.conc_acquirer_entries (hotel_id, sale_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_acquirer_entries TO authenticated;
GRANT ALL ON public.conc_acquirer_entries TO service_role;
ALTER TABLE public.conc_acquirer_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc acquirer all" ON public.conc_acquirer_entries FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));

-- 5. Extrato bancário
CREATE TABLE public.conc_bank_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE SET NULL,
  entry_key text NOT NULL UNIQUE,
  account_name_raw text,
  line_date date,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  matched_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_bank_hotel_date_idx ON public.conc_bank_entries (hotel_id, line_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_bank_entries TO authenticated;
GRANT ALL ON public.conc_bank_entries TO service_role;
ALTER TABLE public.conc_bank_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc bank all" ON public.conc_bank_entries FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));

-- 6. Conciliações manuais (N:1)
CREATE TABLE public.conc_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  kind text NOT NULL CHECK (kind IN ('cartao','pix_extrato')),
  left_total numeric NOT NULL DEFAULT 0,
  right_total numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  note text,
  matched_by uuid NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_matches_hotel_idx ON public.conc_matches (hotel_id, kind, matched_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_matches TO authenticated;
GRANT ALL ON public.conc_matches TO service_role;
ALTER TABLE public.conc_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc matches all" ON public.conc_matches FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));

CREATE TABLE public.conc_match_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.conc_matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('opera','acquirer','bank')),
  entry_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_match_items_match_idx ON public.conc_match_items (match_id);
CREATE INDEX conc_match_items_entry_idx ON public.conc_match_items (entry_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_match_items TO authenticated;
GRANT ALL ON public.conc_match_items TO service_role;
ALTER TABLE public.conc_match_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc match items all" ON public.conc_match_items FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));