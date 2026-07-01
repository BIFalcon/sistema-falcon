CREATE TABLE IF NOT EXISTS public._ar_cleanup_ids (id uuid PRIMARY KEY);
GRANT ALL ON public._ar_cleanup_ids TO service_role;
GRANT INSERT ON public._ar_cleanup_ids TO authenticated;