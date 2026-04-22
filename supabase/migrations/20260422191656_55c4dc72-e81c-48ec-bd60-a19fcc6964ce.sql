-- Campos do estágio Financeiro no fechamento
ALTER TABLE public.closings
  ADD COLUMN IF NOT EXISTS estimated_distribution numeric,
  ADD COLUMN IF NOT EXISTS estimated_lines jsonb,
  ADD COLUMN IF NOT EXISTS estimated_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_distribution numeric,
  ADD COLUMN IF NOT EXISTS distribution_decision text
    CHECK (distribution_decision IN ('enviado', 'sem_distribuicao', 'pendente')),
  ADD COLUMN IF NOT EXISTS distribution_notes text,
  ADD COLUMN IF NOT EXISTS distribution_decided_by uuid,
  ADD COLUMN IF NOT EXISTS distribution_decided_at timestamptz;

-- Índice para buscas por decisão (ex.: dashboard "pendentes")
CREATE INDEX IF NOT EXISTS closings_distribution_decision_idx
  ON public.closings (distribution_decision)
  WHERE distribution_decision IS NOT NULL;