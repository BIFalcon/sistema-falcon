CREATE TABLE IF NOT EXISTS public.omie_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  active boolean NOT NULL DEFAULT true,
  dry_run boolean NOT NULL DEFAULT true,
  secret_app_key_env text NOT NULL,
  secret_app_secret_env text NOT NULL,
  janela_data_inicio date NOT NULL DEFAULT '2025-11-01',
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id)
);

CREATE TABLE IF NOT EXISTS public.omie_fornecedores_cache (
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  codigo_cliente_omie bigint NOT NULL,
  razao_social text,
  nome_fantasia text,
  cnpj_cpf text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, codigo_cliente_omie)
);

CREATE TABLE IF NOT EXISTS public.omie_categorias_cache (
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  codigo text NOT NULL,
  descricao text,
  conta_despesa boolean,
  conta_receita boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.omie_contas_correntes_cache (
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  n_cod_cc bigint NOT NULL,
  descricao text,
  inativo boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, n_cod_cc)
);

CREATE TABLE IF NOT EXISTS public.omie_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  dry_run boolean NOT NULL,
  status text NOT NULL,
  entries_fetched int DEFAULT 0,
  entries_written int DEFAULT 0,
  fornecedores_nao_encontrados int DEFAULT 0,
  status_desconhecidos jsonb DEFAULT '[]'::jsonb,
  categorias_nao_encontradas jsonb DEFAULT '[]'::jsonb,
  error_message text
);

GRANT ALL ON public.omie_sync_config TO service_role;
GRANT ALL ON public.omie_fornecedores_cache TO service_role;
GRANT ALL ON public.omie_categorias_cache TO service_role;
GRANT ALL ON public.omie_contas_correntes_cache TO service_role;
GRANT ALL ON public.omie_sync_logs TO service_role;
GRANT SELECT ON public.omie_sync_config TO authenticated;
GRANT SELECT ON public.omie_sync_logs TO authenticated;

ALTER TABLE public.omie_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omie_fornecedores_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omie_categorias_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omie_contas_correntes_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omie_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master reads omie sync logs" ON public.omie_sync_logs
  FOR SELECT TO authenticated USING (public.is_master(auth.uid()));
CREATE POLICY "master reads omie sync config" ON public.omie_sync_config
  FOR SELECT TO authenticated USING (public.is_master(auth.uid()));

SELECT cron.schedule(
  'omie-ap-sync-daily',
  '0 12 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://hwwwjfzmpgerrkigpgab.supabase.co/functions/v1/omie-ap-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);