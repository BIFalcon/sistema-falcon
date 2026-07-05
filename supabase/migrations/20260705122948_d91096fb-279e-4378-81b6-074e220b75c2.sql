ALTER TABLE public.rh_org_nodes
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS node_type text DEFAULT 'standard';

UPDATE public.rh_org_nodes
SET parent_id = (SELECT id FROM public.rh_org_nodes WHERE name = 'Livia Soares' LIMIT 1)
WHERE name IN ('Daniela Batista', 'Rodrigo')
  AND parent_id = (SELECT id FROM public.rh_org_nodes WHERE name = 'Wanessa' LIMIT 1);