-- 1. Novo status no enum ap_payment_status
ALTER TYPE public.ap_payment_status ADD VALUE IF NOT EXISTS 'em_aprovacao';
ALTER TYPE public.ap_payment_status ADD VALUE IF NOT EXISTS 'autorizado';

-- 2. Novos campos em ap_entries
ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS scheduled_date date NULL,
  ADD COLUMN IF NOT EXISTS bank_account text NULL,
  ADD COLUMN IF NOT EXISTS hotel_cnpj text NULL,
  ADD COLUMN IF NOT EXISTS paid_interest numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS archived_reason text NULL;

-- 3. Tabela de histórico de notificações
CREATE TABLE IF NOT EXISTS public.ap_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  sent_by uuid NOT NULL REFERENCES auth.users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  entry_ids uuid[] NOT NULL DEFAULT '{}',
  recipient_emails text[] NOT NULL DEFAULT '{}',
  message_text text,
  entries_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.ap_notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ap_notification_log_financeiro_master" ON public.ap_notification_log
  FOR ALL
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role));

-- 4. Tabela de saldo de cartão a receber
CREATE TABLE IF NOT EXISTS public.ap_card_receivable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  informed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, date_from, date_to)
);
ALTER TABLE public.ap_card_receivable ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ap_card_receivable_financeiro_master" ON public.ap_card_receivable
  FOR ALL
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role));

-- 5. Separar saldo bancário por banco (Itaú e Santander)
ALTER TABLE public.ap_bank_balance
  ADD COLUMN IF NOT EXISTS bank_name text NOT NULL DEFAULT 'itau';
ALTER TABLE public.ap_bank_balance DROP CONSTRAINT IF EXISTS ap_bank_balance_hotel_id_balance_date_key;
ALTER TABLE public.ap_bank_balance DROP CONSTRAINT IF EXISTS ap_bank_balance_hotel_bank_date_key;
ALTER TABLE public.ap_bank_balance ADD CONSTRAINT ap_bank_balance_hotel_bank_date_key
  UNIQUE (hotel_id, balance_date, bank_name);