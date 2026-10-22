ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_boleto_baixado';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_to_invoice_missing_docs';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_boleto_missing_due_date';