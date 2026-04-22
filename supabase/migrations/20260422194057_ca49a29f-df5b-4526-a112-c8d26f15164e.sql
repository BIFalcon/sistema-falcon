-- 1) Novos campos em investor_letters
ALTER TABLE public.investor_letters
  ADD COLUMN IF NOT EXISTS reserve_fund numeric,
  ADD COLUMN IF NOT EXISTS rps_score numeric,
  ADD COLUMN IF NOT EXISTS operational_comment text,
  ADD COLUMN IF NOT EXISTS last_ai_instruction text,
  ADD COLUMN IF NOT EXISTS ai_version_number integer NOT NULL DEFAULT 0;

-- 2) Tabela de destaques (múltiplos por carta)
CREATE TABLE IF NOT EXISTS public.letter_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL REFERENCES public.investor_letters(id) ON DELETE CASCADE,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  title text NOT NULL,
  note text,
  photo_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_letter_highlights_letter ON public.letter_highlights(letter_id);
CREATE INDEX IF NOT EXISTS idx_letter_highlights_closing ON public.letter_highlights(closing_id);

ALTER TABLE public.letter_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "highlights_select_scoped"
ON public.letter_highlights FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_highlights.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id)));

CREATE POLICY "highlights_insert_authoring"
ON public.letter_highlights FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'gop') OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'gg'))
  AND EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_highlights.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
);

CREATE POLICY "highlights_update_authoring"
ON public.letter_highlights FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_highlights.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'gop') OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'gg'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_highlights.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
);

CREATE POLICY "highlights_delete_authoring"
ON public.letter_highlights FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_highlights.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'gop') OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'gg'))
);

CREATE TRIGGER touch_letter_highlights_updated_at
BEFORE UPDATE ON public.letter_highlights
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Tabela de versões geradas pela IA
CREATE TABLE IF NOT EXISTS public.letter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL REFERENCES public.investor_letters(id) ON DELETE CASCADE,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  ai_intro text,
  ai_market_context text,
  ai_operational text,
  ai_financial text,
  ai_outlook text,
  ai_closing text,
  ai_model text,
  instruction text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (letter_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_letter_versions_letter ON public.letter_versions(letter_id, version_number DESC);

ALTER TABLE public.letter_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letter_versions_select_scoped"
ON public.letter_versions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.closings c WHERE c.id = letter_versions.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id)));

-- inserções vêm da edge function (service role); sem policy de insert para clients

-- 4) Bucket de fotos de destaques
INSERT INTO storage.buckets (id, name, public)
VALUES ('letter-highlights', 'letter-highlights', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "letter_highlights_storage_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
  )
);

CREATE POLICY "letter_highlights_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'letter-highlights'
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
  )
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'gop') OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'gg'))
);

CREATE POLICY "letter_highlights_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
  )
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'gop') OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'gg'))
);