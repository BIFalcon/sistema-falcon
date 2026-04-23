-- Sistema financeiro do hotel
CREATE TYPE public.financial_system AS ENUM ('totvs', 'omie');

ALTER TABLE public.hotels
  ADD COLUMN financial_system public.financial_system;

CREATE TYPE public.ap_entry_approval AS ENUM ('pending', 'approved', 'rejected');

INSERT INTO storage.buckets (id, name, public)
VALUES ('accounts-payable', 'accounts-payable', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.ap_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('report', 'documents')),
  source_system public.financial_system NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  parsed_entries_count int,
  parse_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ap_uploads_hotel_kind_idx ON public.ap_uploads(hotel_id, kind, uploaded_at DESC);

CREATE TABLE public.ap_bank_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  balance_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  informed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, balance_date)
);
CREATE TRIGGER ap_bank_balance_touch
  BEFORE UPDATE ON public.ap_bank_balance
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ap_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.ap_uploads(id) ON DELETE CASCADE,
  source_system public.financial_system NOT NULL,
  entry_key text NOT NULL,
  supplier text NOT NULL,
  cnpj text,
  document_number text,
  description text,
  due_date date,
  amount numeric(14,2) NOT NULL,
  payment_method text,
  category text,
  observation text,
  interest_fees numeric(14,2),
  omie_situation text,
  gg_approval public.ap_entry_approval NOT NULL DEFAULT 'pending',
  gg_approval_by uuid,
  gg_approval_at timestamptz,
  gg_approval_notes text,
  primary_document_id uuid,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, entry_key)
);
CREATE INDEX ap_entries_hotel_due_idx ON public.ap_entries(hotel_id, due_date);
CREATE INDEX ap_entries_upload_idx ON public.ap_entries(upload_id);
CREATE TRIGGER ap_entries_touch
  BEFORE UPDATE ON public.ap_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ap_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  upload_id uuid REFERENCES public.ap_uploads(id) ON DELETE SET NULL,
  entry_id uuid REFERENCES public.ap_entries(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ap_documents_entry_idx ON public.ap_documents(entry_id);
CREATE INDEX ap_documents_hotel_idx ON public.ap_documents(hotel_id);

CREATE OR REPLACE FUNCTION public.is_ap_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master(_user_id) OR public.has_role(_user_id, 'financeiro');
$$;

ALTER TABLE public.ap_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_bank_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads
  FOR SELECT TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_uploads_insert_managers ON public.ap_uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ap_manager(auth.uid()) AND uploaded_by = auth.uid() AND public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_uploads_delete_managers ON public.ap_uploads
  FOR DELETE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_entries_insert_managers ON public.ap_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_entries_update_scoped ON public.ap_entries
  FOR UPDATE TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'))
  )
  WITH CHECK (public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_entries_delete_managers ON public.ap_entries
  FOR DELETE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY ap_documents_select_scoped ON public.ap_documents
  FOR SELECT TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_documents_insert_managers ON public.ap_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ap_manager(auth.uid()) AND uploaded_by = auth.uid() AND public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_documents_update_managers ON public.ap_documents
  FOR UPDATE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_documents_delete_managers ON public.ap_documents
  FOR DELETE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance
  FOR SELECT TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_bank_balance_upsert_managers ON public.ap_bank_balance
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ap_manager(auth.uid()) AND informed_by = auth.uid() AND public.is_hotel_allowed(auth.uid(), hotel_id));
CREATE POLICY ap_bank_balance_update_managers ON public.ap_bank_balance
  FOR UPDATE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  WITH CHECK (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY ap_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'accounts-payable'
    AND public.is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
  );
CREATE POLICY ap_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'accounts-payable'
    AND public.is_ap_manager(auth.uid())
    AND public.is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
  );
CREATE POLICY ap_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'accounts-payable'
    AND public.is_ap_manager(auth.uid())
    AND public.is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
  );