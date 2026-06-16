-- 1) Adiciona o novo valor ao enum de status de pagamento
ALTER TYPE public.ap_payment_status ADD VALUE IF NOT EXISTS 'nao_aprovado_gg';

-- 2) Coluna "Pendente" paralela ao status (default false)
ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS is_pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ap_entries_is_pending_idx
  ON public.ap_entries(hotel_id, is_pending)
  WHERE is_pending = true;