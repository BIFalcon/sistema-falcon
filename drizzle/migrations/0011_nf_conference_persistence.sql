-- Uploads de conferência de notas fiscais (auditoria: hotel do filtro + período)
CREATE TABLE public.nf_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  ref_year int NOT NULL,
  ref_month int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('opera', 'nota')),
  file_name text,
  rows_total int NOT NULL DEFAULT 0,
  rows_inserted int NOT NULL DEFAULT 0,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_uploads TO authenticated;
GRANT ALL ON public.nf_uploads TO service_role;
ALTER TABLE public.nf_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY nf_uploads_select_scoped ON public.nf_uploads
  FOR SELECT TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_uploads_insert_scoped ON public.nf_uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_uploads_delete_scoped ON public.nf_uploads
  FOR DELETE TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));

-- Linhas de hospedagem do Oracle R&A
CREATE TABLE public.nf_opera_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  ref_year int NOT NULL,
  ref_month int NOT NULL,
  upload_id uuid REFERENCES public.nf_uploads(id) ON DELETE SET NULL,
  entry_key text NOT NULL,
  property text,
  confirmation_number text NOT NULL,
  guest_name text,
  arrival date,
  departure date,
  fiscal_bill_number text,
  net_amount numeric NOT NULL DEFAULT 0,
  payment_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX nf_opera_entries_entry_key_uidx ON public.nf_opera_entries (entry_key);
CREATE INDEX nf_opera_entries_scope_idx ON public.nf_opera_entries (hotel_id, ref_year, ref_month, id);
CREATE INDEX nf_opera_entries_conf_idx ON public.nf_opera_entries (hotel_id, ref_year, ref_month, confirmation_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_opera_entries TO authenticated;
GRANT ALL ON public.nf_opera_entries TO service_role;
ALTER TABLE public.nf_opera_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY nf_opera_select_scoped ON public.nf_opera_entries
  FOR SELECT TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_opera_insert_scoped ON public.nf_opera_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_opera_delete_scoped ON public.nf_opera_entries
  FOR DELETE TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));

-- Notas fiscais emitidas (prefeitura)
CREATE TABLE public.nf_nota_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  ref_year int NOT NULL,
  ref_month int NOT NULL,
  upload_id uuid REFERENCES public.nf_uploads(id) ON DELETE SET NULL,
  entry_key text NOT NULL,
  numero_nfse text NOT NULL,
  data_geracao date,
  competencia text,
  situacao text,
  valor_servico numeric NOT NULL DEFAULT 0,
  descricao text,
  rps text,
  confirmation_number text,
  guest_name_extracted text,
  check_in date,
  check_out date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX nf_nota_entries_entry_key_uidx ON public.nf_nota_entries (entry_key);
CREATE INDEX nf_nota_entries_scope_idx ON public.nf_nota_entries (hotel_id, ref_year, ref_month, id);
CREATE INDEX nf_nota_entries_rps_idx ON public.nf_nota_entries (hotel_id, ref_year, ref_month, rps);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_nota_entries TO authenticated;
GRANT ALL ON public.nf_nota_entries TO service_role;
ALTER TABLE public.nf_nota_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY nf_nota_select_scoped ON public.nf_nota_entries
  FOR SELECT TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_nota_insert_scoped ON public.nf_nota_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.can_view_hotel_data(auth.uid(), hotel_id));
CREATE POLICY nf_nota_delete_scoped ON public.nf_nota_entries
  FOR DELETE TO authenticated
  USING (public.can_view_hotel_data(auth.uid(), hotel_id));