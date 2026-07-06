REVOKE SELECT (bank_accounts, cnpj) ON public.hotels FROM anon, authenticated;
REVOKE UPDATE (bank_accounts, cnpj) ON public.hotels FROM anon, authenticated;
REVOKE INSERT (bank_accounts, cnpj) ON public.hotels FROM anon, authenticated;