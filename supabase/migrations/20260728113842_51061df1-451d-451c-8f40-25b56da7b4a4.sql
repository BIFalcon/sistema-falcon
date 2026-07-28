-- Remove leitura ampla da tabela (a coluna bank_accounts/cnpj vinha junto).
REVOKE ALL ON public.hotels FROM anon;
REVOKE SELECT ON public.hotels FROM authenticated;

-- Mantém escrita (restringida por RLS: apenas processos/master).
GRANT INSERT, UPDATE, DELETE ON public.hotels TO authenticated;

-- Leitura apenas das colunas não sensíveis.
GRANT SELECT (
  id, name, brand, active, created_at, cover_url, brand_logo_url,
  financial_system, opera_property_name, show_in_closing,
  num_apartments, is_active, rh_only
) ON public.hotels TO authenticated;

GRANT ALL ON public.hotels TO service_role;