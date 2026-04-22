
-- Letters to investors
CREATE TABLE public.investor_letters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_id UUID NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  -- form fields filled by GOP (highlights)
  highlight_market TEXT,
  highlight_operations TEXT,
  highlight_revenue TEXT,
  highlight_costs TEXT,
  highlight_outlook TEXT,
  custom_notes TEXT,
  -- AI generated narrative (markdown / plain text per slide)
  ai_intro TEXT,
  ai_market_context TEXT,
  ai_operational TEXT,
  ai_financial TEXT,
  ai_outlook TEXT,
  ai_closing TEXT,
  ai_model TEXT,
  ai_generated_at TIMESTAMPTZ,
  -- Final pdf
  pdf_url TEXT,
  pdf_generated_at TIMESTAMPTZ,
  pdf_version INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (closing_id)
);

ALTER TABLE public.investor_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letters_select_scoped"
ON public.investor_letters FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.closings c
  WHERE c.id = investor_letters.closing_id
    AND public.is_hotel_allowed(auth.uid(), c.hotel_id)));

CREATE POLICY "letters_insert_authoring"
ON public.investor_letters FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid())
  AND created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.closings c
    WHERE c.id = closing_id
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
);

CREATE POLICY "letters_update_authoring"
ON public.investor_letters FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.closings c
    WHERE c.id = investor_letters.closing_id
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'gop')
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'gg')
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.closings c
    WHERE c.id = investor_letters.closing_id
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
);

CREATE POLICY "letters_master_delete"
ON public.investor_letters FOR DELETE TO authenticated
USING (public.is_master(auth.uid()));

CREATE TRIGGER trg_letters_touch
BEFORE UPDATE ON public.investor_letters
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies for investor-letters bucket (private)
CREATE POLICY "letters_storage_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'investor-letters'
  AND public.has_any_role(auth.uid())
);

CREATE POLICY "letters_storage_insert_scoped"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'investor-letters'
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'gop')
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'gg')
  )
);

CREATE POLICY "letters_storage_update_master"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'investor-letters' AND public.is_master(auth.uid()));

CREATE POLICY "letters_storage_delete_master"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'investor-letters' AND public.is_master(auth.uid()));

-- Storage policies for closings bucket (DRE Excel uploads) - was missing!
CREATE POLICY "closings_storage_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'closings' AND public.has_any_role(auth.uid()));

CREATE POLICY "closings_storage_insert_uploader"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'closings'
  AND public.is_dre_uploader(auth.uid())
);

CREATE POLICY "closings_storage_master_modify"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'closings' AND public.is_master(auth.uid()));

CREATE POLICY "closings_storage_master_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'closings' AND public.is_master(auth.uid()));

-- Trigger: when DRE is approved, automatically advance Carta to aguardando_gg
-- (unless hotel skips Carta -> mark Carta as nao_aplicavel)
CREATE OR REPLACE FUNCTION public.advance_carta_on_dre_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status_dre = 'aprovado' AND OLD.status_dre IS DISTINCT FROM 'aprovado' THEN
    IF NEW.hotel_id = 'ibis-budget-recife' THEN
      IF NEW.status_carta = 'nao_iniciado' THEN
        NEW.status_carta := 'nao_aplicavel';
      END IF;
    ELSE
      IF NEW.status_carta = 'nao_iniciado' THEN
        NEW.status_carta := 'aguardando_gg';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advance_carta ON public.closings;
CREATE TRIGGER trg_advance_carta
BEFORE UPDATE ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.advance_carta_on_dre_approval();
