-- 1. Novos campos
ALTER TABLE public.conc_opera_entries
  ADD COLUMN IF NOT EXISTS b2b boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS b2b_by uuid,
  ADD COLUMN IF NOT EXISTS b2b_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_paid_date date,
  ADD COLUMN IF NOT EXISTS cash_proof_path text,
  ADD COLUMN IF NOT EXISTS cash_paid_by uuid,
  ADD COLUMN IF NOT EXISTS cash_paid_at timestamptz;

ALTER TABLE public.conc_acquirer_entries
  ADD COLUMN IF NOT EXISTS b2b boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS b2b_by uuid,
  ADD COLUMN IF NOT EXISTS b2b_at timestamptz;

-- 2. Função de permissão para GG/ADM (justificar / dinheiro pago)
CREATE OR REPLACE FUNCTION public.can_justify_conciliacao(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_conciliacao(_user_id)
      OR public.has_role(_user_id, 'financeiro')
      OR (
        (public.has_role(_user_id, 'gg') OR public.has_role(_user_id, 'adm'))
        AND public.can_view_hotel_data(_user_id, _hotel_id)
      )
$$;

REVOKE ALL ON FUNCTION public.can_justify_conciliacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_justify_conciliacao(uuid, text) TO authenticated, service_role;

-- 3. Tabela de justificativas
CREATE TABLE IF NOT EXISTS public.conc_justifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  side text NOT NULL,
  entry_id uuid NOT NULL,
  kind text NOT NULL,
  note text NOT NULL,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_justifications TO authenticated;
GRANT ALL ON public.conc_justifications TO service_role;

ALTER TABLE public.conc_justifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conc just read" ON public.conc_justifications;
CREATE POLICY "conc just read" ON public.conc_justifications
  FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "conc just insert" ON public.conc_justifications;
CREATE POLICY "conc just insert" ON public.conc_justifications
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_justify_conciliacao(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "conc just update" ON public.conc_justifications;
CREATE POLICY "conc just update" ON public.conc_justifications
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.can_access_conciliacao(auth.uid()))
  WITH CHECK (public.can_justify_conciliacao(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "conc just delete" ON public.conc_justifications;
CREATE POLICY "conc just delete" ON public.conc_justifications
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.can_access_conciliacao(auth.uid()));

DROP TRIGGER IF EXISTS conc_just_touch ON public.conc_justifications;
CREATE TRIGGER conc_just_touch BEFORE UPDATE ON public.conc_justifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS conc_just_entry_idx ON public.conc_justifications (entry_id);

-- 4. Leitura para GG/ADM nos lançamentos dos seus hotéis
DROP POLICY IF EXISTS "conc opera read gg" ON public.conc_opera_entries;
CREATE POLICY "conc opera read gg" ON public.conc_opera_entries
  FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "conc acquirer read gg" ON public.conc_acquirer_entries;
CREATE POLICY "conc acquirer read gg" ON public.conc_acquirer_entries
  FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "conc bank read gg" ON public.conc_bank_entries;
CREATE POLICY "conc bank read gg" ON public.conc_bank_entries
  FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

-- GG/ADM podem marcar dinheiro como pago (a coluna é validada no app;
-- a policy garante apenas o escopo de hotel)
DROP POLICY IF EXISTS "conc opera cash update gg" ON public.conc_opera_entries;
CREATE POLICY "conc opera cash update gg" ON public.conc_opera_entries
  FOR UPDATE TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id))
  WITH CHECK (public.can_justify_conciliacao(auth.uid(), hotel_id));

-- 5. Correção retroativa: reverter "direto no banco"
UPDATE public.conc_opera_entries
   SET direct_bank = false, direct_bank_by = NULL, direct_bank_at = NULL
 WHERE direct_bank = true OR direct_bank_by IS NOT NULL OR direct_bank_at IS NOT NULL;