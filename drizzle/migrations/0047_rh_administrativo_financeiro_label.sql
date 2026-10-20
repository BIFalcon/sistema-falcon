CREATE OR REPLACE FUNCTION public.rh_department_for_position(_position text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH normalized AS (SELECT lower(regexp_replace(translate(coalesce(_position,''),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),'[^a-zA-Z0-9]+',' ','g')) AS p)
SELECT CASE
 WHEN p ~ '(pessoas? e cultura|recursos humanos|(^| )rh( |$))' THEN 'Recursos Humanos'
 WHEN p ~ '(cozinha|cozinheir|alimentos|bebidas|(^| )a (e )?b( |$)|maitre|garco[mn]|steward|restaurante|eventos)' THEN 'Alimentos & Bebidas'
 WHEN p ~ '(camareir|arrumad|governant|governanca|(^| )andar(es)?( |$)|limpeza|servicos? gerais|servicoes gerais)' THEN 'Governança'
 WHEN p ~ 'manutenc' THEN 'Manutenção'
 WHEN p ~ '(hospedag|recepc|noturno|guest experience|manobrista|reservas|comercial)' THEN 'Recepção & Atendimento'
 WHEN p ~ '(administrativ|(^| )adm( |$)|financeir|controladoria|almoxarife|escritorio|sistemas)' THEN 'Administrativo & Financeiro'
 WHEN p ~ '(gerente|operac|operacional|gestao estrategica|processos)' THEN 'Gestão & Operações'
 ELSE NULL END FROM normalized;
$fn$;
REVOKE ALL ON FUNCTION public.rh_department_for_position(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rh_department_for_position(text) TO service_role;