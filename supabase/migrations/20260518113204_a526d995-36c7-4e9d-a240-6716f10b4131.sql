DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_event' AND e.enumlabel = 'open_folio_overdue'
  ) THEN
    ALTER TYPE public.notification_event ADD VALUE 'open_folio_overdue';
  END IF;
END$$;