
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_hotel_action_to_controladoria';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_controladoria_action_to_hotel';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_open_folio_upload_to_hotel';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'ar_to_invoice_upload_to_hotel';
