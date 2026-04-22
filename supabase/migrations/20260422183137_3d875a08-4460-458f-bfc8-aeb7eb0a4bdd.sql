-- ============================================================
-- ENUM de status do fechamento
-- ============================================================
CREATE TYPE public.closing_status AS ENUM (
  'nao_iniciado',
  'em_andamento',
  'pendente',
  'aprovado',
  'devolvido',
  'aguardando_comentarios',
  'aguardando_controladoria',
  'aguardando_gop',
  'aguardando_fernando',
  'aguardando_gg',
  'nao_aplicavel',
  'sem_distribuicao'
);

CREATE TYPE public.closing_stage AS ENUM ('dre', 'carta', 'financeiro', 'envio');

-- ============================================================
-- Helper: usuário pode acessar dados de um hotel?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;

-- ============================================================
-- Helper: usuário pode fazer upload de DRE?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_dre_uploader(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'gop');
$$;

-- ============================================================
-- TABELA: closings
-- ============================================================
CREATE TABLE public.closings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),

  status_dre        public.closing_status NOT NULL DEFAULT 'nao_iniciado',
  status_carta      public.closing_status NOT NULL DEFAULT 'nao_iniciado',
  status_financeiro public.closing_status NOT NULL DEFAULT 'nao_iniciado',
  status_envio      public.closing_status NOT NULL DEFAULT 'nao_iniciado',

  dre_started_at         timestamptz,
  dre_approved_at        timestamptz,
  carta_started_at       timestamptz,
  carta_approved_at      timestamptz,
  financeiro_started_at  timestamptz,
  financeiro_resolved_at timestamptz,
  envio_sent_at          timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, month, year)
);

CREATE INDEX idx_closings_hotel ON public.closings(hotel_id);
CREATE INDEX idx_closings_period ON public.closings(year, month);

ALTER TABLE public.closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY closings_select_scoped ON public.closings
  FOR SELECT TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY closings_insert_scoped ON public.closings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_hotel_allowed(auth.uid(), hotel_id));

CREATE POLICY closings_update_scoped ON public.closings
  FOR UPDATE TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id))
  WITH CHECK (public.is_hotel_allowed(auth.uid(), hotel_id));

-- (sem DELETE)

CREATE TRIGGER trg_closings_updated_at
BEFORE UPDATE ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- Trigger: registra mudanças de status em closing_status_log
-- e atualiza timestamps de SLA
-- ============================================================
CREATE TABLE public.closing_status_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value public.closing_status,
  new_value public.closing_status NOT NULL,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_closing_status_log_closing ON public.closing_status_log(closing_id);

ALTER TABLE public.closing_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY status_log_select_scoped ON public.closing_status_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

-- inserção feita pelo trigger (security definer); sem policy de INSERT direto
-- (apenas roles superuser via trigger)

CREATE OR REPLACE FUNCTION public.log_closing_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- DRE
  IF NEW.status_dre IS DISTINCT FROM OLD.status_dre THEN
    INSERT INTO public.closing_status_log (closing_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status_dre', OLD.status_dre, NEW.status_dre, v_uid);

    IF NEW.status_dre = 'aguardando_comentarios' AND OLD.dre_started_at IS NULL THEN
      NEW.dre_started_at := now();
    END IF;
    IF NEW.status_dre = 'aprovado' THEN
      NEW.dre_approved_at := now();
      -- gatilho: financeiro entra em andamento
      IF NEW.status_financeiro = 'nao_iniciado' THEN
        NEW.status_financeiro := 'em_andamento';
      END IF;
    END IF;
  END IF;

  -- Carta
  IF NEW.status_carta IS DISTINCT FROM OLD.status_carta THEN
    INSERT INTO public.closing_status_log (closing_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status_carta', OLD.status_carta, NEW.status_carta, v_uid);

    IF NEW.status_carta = 'aguardando_gg' AND OLD.carta_started_at IS NULL THEN
      NEW.carta_started_at := now();
    END IF;
    IF NEW.status_carta = 'aprovado' THEN
      NEW.carta_approved_at := now();
    END IF;
  END IF;

  -- Financeiro
  IF NEW.status_financeiro IS DISTINCT FROM OLD.status_financeiro THEN
    INSERT INTO public.closing_status_log (closing_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status_financeiro', OLD.status_financeiro, NEW.status_financeiro, v_uid);

    IF NEW.status_financeiro = 'em_andamento' AND OLD.financeiro_started_at IS NULL THEN
      NEW.financeiro_started_at := now();
    END IF;
    IF NEW.status_financeiro IN ('aprovado', 'sem_distribuicao') THEN
      NEW.financeiro_resolved_at := now();
    END IF;
  END IF;

  -- Envio
  IF NEW.status_envio IS DISTINCT FROM OLD.status_envio THEN
    INSERT INTO public.closing_status_log (closing_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status_envio', OLD.status_envio, NEW.status_envio, v_uid);

    IF NEW.status_envio = 'aprovado' THEN
      NEW.envio_sent_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_closings_log_status
BEFORE UPDATE ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.log_closing_status_change();

-- Também loga status iniciais != nao_iniciado em INSERT
CREATE OR REPLACE FUNCTION public.log_closing_status_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.status_dre IS NOT NULL AND NEW.status_dre <> 'nao_iniciado' THEN
    INSERT INTO public.closing_status_log (closing_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status_dre', NULL, NEW.status_dre, v_uid);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_closings_log_status_insert
AFTER INSERT ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.log_closing_status_insert();

-- ============================================================
-- TABELA: dre_versions
-- ============================================================
CREATE TABLE public.dre_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closing_id, version_number)
);

CREATE INDEX idx_dre_versions_closing ON public.dre_versions(closing_id);

ALTER TABLE public.dre_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dre_versions_select_scoped ON public.dre_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY dre_versions_insert_uploader ON public.dre_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_dre_uploader(auth.uid())
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

-- ============================================================
-- TABELA: dre_parsed_lines (estimativas futuras)
-- ============================================================
CREATE TABLE public.dre_parsed_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  line_label text NOT NULL,
  line_value numeric,
  line_type text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dre_parsed_lines_closing ON public.dre_parsed_lines(closing_id);
CREATE INDEX idx_dre_parsed_lines_label ON public.dre_parsed_lines(line_label);

ALTER TABLE public.dre_parsed_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY dre_parsed_lines_select_scoped ON public.dre_parsed_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY dre_parsed_lines_insert_uploader ON public.dre_parsed_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_dre_uploader(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

-- ============================================================
-- TABELA: comments
-- ============================================================
CREATE TABLE public.comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  stage public.closing_stage NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(content) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_closing_stage ON public.comments(closing_id, stage);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_select_scoped ON public.comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY comments_insert_any_role ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid())
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY comments_master_modify ON public.comments
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

-- ============================================================
-- TABELA: approvals
-- ============================================================
CREATE TABLE public.approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  stage public.closing_stage NOT NULL,
  approved_by uuid NOT NULL,
  status public.closing_status NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_closing_stage ON public.approvals(closing_id, stage);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY approvals_select_scoped ON public.approvals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY approvals_insert_any_role ON public.approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid())
    AND approved_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY approvals_master_modify ON public.approvals
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('closings', 'closings', false),
  ('investor-letters', 'investor-letters', false),
  ('hotel-assets', 'hotel-assets', true),
  ('system-assets', 'system-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Policies bucket 'closings' (privado, planilhas DRE)
CREATE POLICY storage_closings_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'closings' AND public.has_any_role(auth.uid()));

CREATE POLICY storage_closings_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'closings' AND public.is_dre_uploader(auth.uid()));

CREATE POLICY storage_closings_master_modify ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'closings' AND public.is_master(auth.uid()))
  WITH CHECK (bucket_id = 'closings' AND public.is_master(auth.uid()));

-- Policies bucket 'investor-letters' (privado, PDFs)
CREATE POLICY storage_letters_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'investor-letters' AND public.has_any_role(auth.uid()));

CREATE POLICY storage_letters_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'investor-letters' AND public.has_any_role(auth.uid()));

CREATE POLICY storage_letters_master_modify ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'investor-letters' AND public.is_master(auth.uid()))
  WITH CHECK (bucket_id = 'investor-letters' AND public.is_master(auth.uid()));

-- Policies bucket 'hotel-assets' (público leitura, escrita Master)
CREATE POLICY storage_hotel_assets_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'hotel-assets');

CREATE POLICY storage_hotel_assets_master_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'hotel-assets' AND public.is_master(auth.uid()))
  WITH CHECK (bucket_id = 'hotel-assets' AND public.is_master(auth.uid()));

-- Policies bucket 'system-assets' (público leitura, escrita Master)
CREATE POLICY storage_system_assets_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'system-assets');

CREATE POLICY storage_system_assets_master_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'system-assets' AND public.is_master(auth.uid()))
  WITH CHECK (bucket_id = 'system-assets' AND public.is_master(auth.uid()));