
CREATE TABLE public.conciliation_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  period date NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  razao_file_name text,
  journal_file_name text,
  status text DEFAULT 'pending'
);

CREATE TABLE public.conciliation_razao_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.conciliation_uploads(id) ON DELETE CASCADE,
  line_date date NOT NULL,
  descricao text NOT NULL,
  lancamento text,
  historico text,
  documento text,
  valor_debito numeric DEFAULT 0,
  valor_credito numeric DEFAULT 0,
  is_totalizador boolean DEFAULT false
);

CREATE TABLE public.conciliation_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.conciliation_uploads(id) ON DELETE CASCADE,
  line_date date NOT NULL,
  transaction_number text NOT NULL,
  receipt_number text,
  transaction_code text NOT NULL,
  transaction_description text,
  guest_first_name text,
  guest_last_name text,
  company_name text,
  debit numeric DEFAULT 0,
  credit numeric DEFAULT 0,
  categoria text
);

ALTER TABLE public.conciliation_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliation_razao_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliation_journal_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master e controladoria" ON public.conciliation_uploads
  FOR ALL USING (
    public.is_master(auth.uid()) OR
    public.has_role(auth.uid(), 'controladoria')
  );
CREATE POLICY "Master e controladoria" ON public.conciliation_razao_lines
  FOR ALL USING (
    public.is_master(auth.uid()) OR
    public.has_role(auth.uid(), 'controladoria')
  );
CREATE POLICY "Master e controladoria" ON public.conciliation_journal_lines
  FOR ALL USING (
    public.is_master(auth.uid()) OR
    public.has_role(auth.uid(), 'controladoria')
  );
