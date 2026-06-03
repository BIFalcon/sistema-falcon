ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'adm';
ALTER TYPE public.ar_gg_status ADD VALUE IF NOT EXISTS 'documentos_enviados';
ALTER TYPE public.ar_gg_status ADD VALUE IF NOT EXISTS 'nao_faturavel';
ALTER TYPE public.ar_gg_status ADD VALUE IF NOT EXISTS 'pago';
ALTER TYPE public.ar_gg_status ADD VALUE IF NOT EXISTS 'inadimplente';