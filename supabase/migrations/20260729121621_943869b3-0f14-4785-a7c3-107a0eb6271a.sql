CREATE TABLE public.hotel_contexto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  respondido_por uuid REFERENCES auth.users(id),
  respondido_em timestamptz,
  quem_sustenta_hotel text,
  mudanca_praca text,
  atrapalha_operacao text,
  desconto_frequente text,
  prioridade_3_meses text,
  ultima_confirmacao_em timestamptz,
  sem_mudancas_desde_ultima boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id)
);

CREATE TRIGGER trg_hotel_contexto_updated_at
  BEFORE UPDATE ON public.hotel_contexto
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.hotel_contexto TO authenticated;
GRANT ALL ON public.hotel_contexto TO service_role;

ALTER TABLE public.hotel_contexto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotel_contexto_select" ON public.hotel_contexto
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = auth.uid() AND hotel_id = hotel_contexto.hotel_id
    )
  );

CREATE POLICY "hotel_contexto_insert" ON public.hotel_contexto
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_master(auth.uid())
    OR (
      public.has_role(auth.uid(), 'gg')
      AND EXISTS (
        SELECT 1 FROM public.user_hotels
        WHERE user_id = auth.uid() AND hotel_id = hotel_contexto.hotel_id
      )
    )
  );

CREATE POLICY "hotel_contexto_update" ON public.hotel_contexto
  FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (
      public.has_role(auth.uid(), 'gg')
      AND EXISTS (
        SELECT 1 FROM public.user_hotels
        WHERE user_id = auth.uid() AND hotel_id = hotel_contexto.hotel_id
      )
    )
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR (
      public.has_role(auth.uid(), 'gg')
      AND EXISTS (
        SELECT 1 FROM public.user_hotels
        WHERE user_id = auth.uid() AND hotel_id = hotel_contexto.hotel_id
      )
    )
  );

ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'hotel_contexto_request';