CREATE INDEX IF NOT EXISTS notif_queue_recipient_pending_idx
  ON public.notification_queue (recipient_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notif_queue_status_sched_idx
  ON public.notification_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS ar_ti_hotel_status_date_idx
  ON public.ar_to_invoice_entries (hotel_id, gg_status, transaction_date);