CREATE OR REPLACE FUNCTION public.month_pt(_m int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT (ARRAY['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])[_m];
$$;