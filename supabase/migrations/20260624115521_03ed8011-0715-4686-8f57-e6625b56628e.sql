ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS rh_only boolean NOT NULL DEFAULT false;

INSERT INTO public.hotels (id, name, brand, active, is_active, show_in_closing, rh_only)
VALUES ('matriz', 'Matriz', 'Falcon', true, true, false, true)
ON CONFLICT (id) DO UPDATE SET rh_only = true, show_in_closing = false, name = EXCLUDED.name;