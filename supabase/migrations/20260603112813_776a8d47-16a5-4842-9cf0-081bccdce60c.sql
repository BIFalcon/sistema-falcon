-- Bloco 2 — ar_clients
CREATE TABLE IF NOT EXISTS public.ar_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  cnpj_cpf text,
  email text,
  payment_term_days integer NOT NULL DEFAULT 30,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_clients TO authenticated;
GRANT ALL ON public.ar_clients TO service_role;

ALTER TABLE public.ar_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_clients_select_scoped"
ON public.ar_clients FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro'::app_role)
  OR public.has_role(auth.uid(), 'controladoria'::app_role)
  OR public.is_hotel_allowed(auth.uid(), hotel_id)
);

CREATE POLICY "ar_clients_write_scoped"
ON public.ar_clients FOR INSERT TO authenticated
WITH CHECK (
  (created_by = auth.uid())
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'financeiro'::app_role)
    OR (
      (public.has_role(auth.uid(), 'adm'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    )
  )
);

CREATE POLICY "ar_clients_update_scoped"
ON public.ar_clients FOR UPDATE TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro'::app_role)
  OR (
    (public.has_role(auth.uid(), 'adm'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
    AND public.is_hotel_allowed(auth.uid(), hotel_id)
  )
)
WITH CHECK (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro'::app_role)
  OR (
    (public.has_role(auth.uid(), 'adm'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
    AND public.is_hotel_allowed(auth.uid(), hotel_id)
  )
);

CREATE POLICY "ar_clients_delete_managers"
ON public.ar_clients FOR DELETE TO authenticated
USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role));

CREATE TRIGGER ar_clients_touch_updated_at
BEFORE UPDATE ON public.ar_clients
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Novos campos em ar_to_invoice_entries
ALTER TABLE public.ar_to_invoice_entries
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.ar_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_not_billable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS not_billable_reason text,
  ADD COLUMN IF NOT EXISTS not_billable_note text,
  ADD COLUMN IF NOT EXISTS proof_file text,
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_defaulting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS defaulting_note text,
  ADD COLUMN IF NOT EXISTS defaulting_at timestamptz,
  ADD COLUMN IF NOT EXISTS documents_problem_note text,
  ADD COLUMN IF NOT EXISTS documents_problem_at timestamptz,
  ADD COLUMN IF NOT EXISTS billed_at timestamptz;

-- Bloco 5 — Open Folio: company / travel_agent
ALTER TABLE public.ar_open_folio_entries
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS travel_agent text;

-- Histórico de alterações da data prevista de fechamento
CREATE TABLE IF NOT EXISTS public.ar_open_folio_date_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.ar_open_folio_entries(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  old_date date,
  new_date date,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

GRANT SELECT, INSERT ON public.ar_open_folio_date_history TO authenticated;
GRANT ALL ON public.ar_open_folio_date_history TO service_role;

ALTER TABLE public.ar_open_folio_date_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_ofdh_select_scoped"
ON public.ar_open_folio_date_history FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'financeiro'::app_role)
  OR public.has_role(auth.uid(), 'controladoria'::app_role)
  OR public.is_hotel_allowed(auth.uid(), hotel_id)
);

CREATE POLICY "ar_ofdh_insert_scoped"
ON public.ar_open_folio_date_history FOR INSERT TO authenticated
WITH CHECK (
  (changed_by = auth.uid())
  AND (
    public.is_ar_manager(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'adm'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    )
  )
);

-- Atualiza is_hotel_allowed para incluir 'adm' (escopo por user_hotels — sem bypass global).
-- A função já segue o padrão: roles globais bypass, demais via user_hotels.
-- 'adm' não entra no bypass — segue pelo EXISTS user_hotels. Nenhuma mudança necessária aqui.