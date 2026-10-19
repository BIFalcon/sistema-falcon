CREATE OR REPLACE FUNCTION public.rh_department_for_position(_position text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public
AS $fn$
WITH normalized AS (SELECT lower(regexp_replace(translate(coalesce(_position,''),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),'[^a-zA-Z0-9]+',' ','g')) AS p)
SELECT CASE
 WHEN p ~ '(pessoas? e cultura|recursos humanos|(^| )rh( |$))' THEN 'Recursos Humanos'
 WHEN p ~ '(cozinha|cozinheir|alimentos|bebidas|(^| )a (e )?b( |$)|maitre|garco[mn]|steward|restaurante|eventos)' THEN 'Alimentos & Bebidas'
 WHEN p ~ '(camareir|arrumad|governant|governanca|andares|limpeza|servicos? gerais|servicoes gerais)' THEN 'Governança'
 WHEN p ~ 'manutenc' THEN 'Manutenção'
 WHEN p ~ '(hospedag|recepc|noturno|guest experience|manobrista|reservas|comercial)' THEN 'Hospedagem'
 WHEN p ~ '(administrativ|(^| )adm( |$)|financeir|controladoria|almoxarife|escritorio|sistemas)' THEN 'Administrativo, Financeiro & Controladoria'
 WHEN p ~ '(gerente|operac|operacional|gestao estrategica|processos)' THEN 'Gestão & Operações'
 ELSE NULL END FROM normalized;
$fn$;
REVOKE ALL ON FUNCTION public.rh_department_for_position(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_department_for_position(text) TO service_role;

CREATE OR REPLACE FUNCTION public.rh_assign_monthly_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
BEGIN
 IF NEW.source_format = 'CONSOLIDADO' THEN
  NEW.department := public.rh_department_for_position(NEW.position);
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rh_assign_monthly_department() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_assign_monthly_department() TO service_role;
CREATE TRIGGER rh_monthly_department BEFORE INSERT OR UPDATE OF position, source_format ON public.rh_employees FOR EACH ROW EXECUTE FUNCTION public.rh_assign_monthly_department();