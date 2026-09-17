-- 1) Tabela de cache do Consolidado de Resultados
CREATE TABLE IF NOT EXISTS public.consolidado_resultados_cache (
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  closing_id uuid,
  status_dre text,
  ocupacao numeric,
  adr numeric,
  revpar numeric,
  receita_bruta numeric,
  taxa_fee numeric,
  incentive_fee numeric,
  distribuicao_total numeric,
  uhs_disponiveis numeric,
  distribuicao_por_uh numeric,
  gop numeric,
  fundo_reserva numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, year, month)
);

CREATE INDEX IF NOT EXISTS consolidado_cache_period_idx
  ON public.consolidado_resultados_cache (year, month);

GRANT SELECT ON public.consolidado_resultados_cache TO authenticated;
GRANT ALL ON public.consolidado_resultados_cache TO service_role;

ALTER TABLE public.consolidado_resultados_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consolidado_cache_select_scoped ON public.consolidado_resultados_cache;
CREATE POLICY consolidado_cache_select_scoped
ON public.consolidado_resultados_cache
FOR SELECT TO authenticated
USING (public.can_view_hotel_data(auth.uid(), hotel_id));

-- 2) Helpers de leitura das linhas da DRE (mesma lógica do front)

-- Primeiro valor não-nulo/não-zero entre linhas contábeis (line_type <> 'indicator')
CREATE OR REPLACE FUNCTION public.consolidado_line_value(
  _closing_id uuid, _version integer, _patterns text[]
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p text; v numeric;
BEGIN
  IF _closing_id IS NULL OR _version IS NULL THEN RETURN NULL; END IF;
  FOREACH p IN ARRAY _patterns LOOP
    SELECT d.line_value INTO v
    FROM public.dre_parsed_lines d
    WHERE d.closing_id = _closing_id
      AND d.version_number = _version
      AND COALESCE(d.line_type, '') <> 'indicator'
      AND d.line_label ~* p
      AND d.line_value IS NOT NULL
      AND d.line_value <> 0
    ORDER BY d.created_at, d.id
    LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Existe alguma linha contábil com esse rótulo (independente do valor)?
CREATE OR REPLACE FUNCTION public.consolidado_has_line(
  _closing_id uuid, _version integer, _patterns text[]
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p text;
BEGIN
  IF _closing_id IS NULL OR _version IS NULL THEN RETURN false; END IF;
  FOREACH p IN ARRAY _patterns LOOP
    IF EXISTS (
      SELECT 1 FROM public.dre_parsed_lines d
      WHERE d.closing_id = _closing_id
        AND d.version_number = _version
        AND COALESCE(d.line_type, '') <> 'indicator'
        AND d.line_label ~* p
    ) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- Indicador por chave exata: [chave] Rótulo
CREATE OR REPLACE FUNCTION public.consolidado_indicator(
  _closing_id uuid, _version integer, _key text
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.line_value
  FROM public.dre_parsed_lines d
  WHERE d.closing_id = _closing_id
    AND d.version_number = _version
    AND d.line_type = 'indicator'
    AND d.line_label ~* ('^\[' || _key || '\]')
  ORDER BY d.created_at, d.id
  LIMIT 1;
$$;

-- Fallback: indicador cujo rótulo (sem o prefixo [chave]) bate com os padrões.
-- Ignora bline_* (orçamento) e pline_* (ano anterior); cline_N só do mês alvo.
CREATE OR REPLACE FUNCTION public.consolidado_indicator_by_pattern(
  _closing_id uuid, _version integer, _patterns text[], _month integer
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p text; v numeric;
BEGIN
  IF _closing_id IS NULL OR _version IS NULL THEN RETURN NULL; END IF;
  FOREACH p IN ARRAY _patterns LOOP
    SELECT d.line_value INTO v
    FROM public.dre_parsed_lines d
    WHERE d.closing_id = _closing_id
      AND d.version_number = _version
      AND d.line_type = 'indicator'
      AND d.line_value IS NOT NULL
      AND d.line_value <> 0
      AND (substring(d.line_label from '^\s*\[([^\]]+)\]\s*') IS NULL
           OR substring(d.line_label from '^\s*\[([^\]]+)\]\s*') !~* '^(bline|pline)_')
      AND (
        substring(d.line_label from '^\s*\[([^\]]+)\]\s*') IS NULL
        OR substring(d.line_label from '^\s*\[([^\]]+)\]\s*') !~* '^cline_[0-9]{1,2}$'
        OR (_month IS NOT NULL
            AND substring(d.line_label from '^\s*\[cline_([0-9]{1,2})\]') IS NOT NULL
            AND substring(d.line_label from '^\s*\[cline_([0-9]{1,2})\]')::int = _month)
      )
      AND regexp_replace(d.line_label, '^\s*\[[^\]]+\]\s*', '') ~* p
    ORDER BY d.created_at, d.id
    LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- 3) Recalcula (upsert) a linha do cache de um closing
CREATE OR REPLACE FUNCTION public.recalc_consolidado_cache(_closing_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  v_version integer;
  v_num_apartments integer;
  v_taxa_fee numeric;
  v_incentive numeric;
  v_fundo numeric;
  v_lucro numeric;
  v_distrib_total numeric;
  v_distrib_uh numeric;
  v_from_dre numeric;
  v_patterns text[];
  taxa_fee_patterns text[] := ARRAY[
    'taxas?\s+(de\s+)?administra[çc][ãa]o\s+falcon',
    'taxa\s+falcon',
    '^fees?\s+falcon',
    'fees?\s+falcon\s+hotels?',
    'taxas?\s+(de\s+)?administra[çc][ãa]o\s+s/\s*receita'
  ];
  taxa_sucesso_patterns text[] := ARRAY[
    'taxa\s+(de\s+)?sucesso',
    'incentive\s+fee',
    'taxa\s+(de\s+)?administra[çc][ãa]o\s+s/\s*gop',
    'taxa\s+de\s+administra[çc][ãa]o\s+s[/\\]\s*gop',
    'taxa.*adm.*gop',
    '5010209006'
  ];
  fundo_patterns text[] := ARRAY[
    'fundo\s+de\s+reservas?\s+e\s+reposi[çc][ãa]o\s+patrimonial',
    'fundo\s+de\s+reservas?(\s+e\s+reposi[çc][ãa]o)?',
    'reposi[çc][ãa]o\s+patrimonial'
  ];
  distrib_uh_patterns text[] := ARRAY[
    'distribui[çc][ãa]o\s+por\s+(tipo\s+(de\s+)?)?uh',
    '^por\s+uh$',
    'distribui[çc][ãa]o\s+por\s+uh',
    'dividendo\s+efetivamente\s+distribu[íi]do\s+\(por\s+apartamento\)'
  ];
  lucro_patterns text[] := ARRAY[
    'lucro\s*/?\s*preju[íi]zo\s+a\s+distribuir\s+(do|no)\s+per[íi]odo',
    'lucro\s*/?\s*preju[íi]zo\s+a\s+distribuir',
    '^\s*lucro\s+a\s+distribuir',
    '^\s*preju[íi]zo\s+a\s+distribuir',
    'resultado\s+a\s+distribuir'
  ];
BEGIN
  IF _closing_id IS NULL THEN RETURN; END IF;

  SELECT id, hotel_id, year, month, status_dre::text AS status_dre,
         final_distribution, estimated_distribution
    INTO c
  FROM public.closings WHERE id = _closing_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT MAX(version_number) INTO v_version
  FROM public.dre_parsed_lines WHERE closing_id = _closing_id;

  SELECT num_apartments INTO v_num_apartments FROM public.hotels WHERE id = c.hotel_id;

  v_taxa_fee := public.consolidado_line_value(_closing_id, v_version, taxa_fee_patterns);

  IF public.consolidado_has_line(_closing_id, v_version, taxa_sucesso_patterns) THEN
    v_incentive := public.consolidado_line_value(_closing_id, v_version, taxa_sucesso_patterns);
  ELSE
    v_incentive := public.consolidado_indicator_by_pattern(
      _closing_id, v_version, taxa_sucesso_patterns, c.month);
  END IF;

  v_fundo := public.consolidado_line_value(_closing_id, v_version, fundo_patterns);

  IF c.hotel_id = 'ibis-budget-recife' THEN
    v_patterns := ARRAY[
      '^resultado\s+operacional\s+l[íi]quido',
      'lucro\s*/?\s*preju[íi]zo\s+a\s+distribuir\s+(do|no)\s+per[íi]odo',
      'lucro\s*/?\s*preju[íi]zo\s+a\s+distribuir'
    ];
  ELSE
    v_patterns := lucro_patterns;
  END IF;

  v_lucro := public.consolidado_line_value(_closing_id, v_version, v_patterns);
  v_distrib_total := COALESCE(v_lucro, c.final_distribution, c.estimated_distribution);

  IF c.hotel_id IN ('ibis-styles-confins', 'mercure-macae', 'ibis-budget-recife') THEN
    v_distrib_uh := NULL;
  ELSE
    v_from_dre := public.consolidado_line_value(_closing_id, v_version, distrib_uh_patterns);
    IF v_from_dre IS NOT NULL THEN
      v_distrib_uh := abs(v_from_dre);
    ELSIF v_distrib_total IS NOT NULL AND COALESCE(v_num_apartments, 0) > 0 THEN
      v_distrib_uh := v_distrib_total / v_num_apartments;
    ELSE
      v_distrib_uh := NULL;
    END IF;
  END IF;

  INSERT INTO public.consolidado_resultados_cache AS t (
    hotel_id, year, month, closing_id, status_dre,
    ocupacao, adr, revpar, receita_bruta, taxa_fee, incentive_fee,
    distribuicao_total, uhs_disponiveis, distribuicao_por_uh, gop, fundo_reserva, updated_at
  ) VALUES (
    c.hotel_id, c.year, c.month, c.id, c.status_dre,
    public.consolidado_indicator(_closing_id, v_version, 'ocupacao'),
    public.consolidado_indicator(_closing_id, v_version, 'adr'),
    public.consolidado_indicator(_closing_id, v_version, 'revpar'),
    public.consolidado_indicator(_closing_id, v_version, 'receita_bruta_total'),
    CASE WHEN v_taxa_fee IS NULL THEN NULL ELSE abs(v_taxa_fee) END,
    CASE WHEN v_incentive IS NULL THEN NULL ELSE abs(v_incentive) END,
    v_distrib_total,
    public.consolidado_indicator(_closing_id, v_version, 'uhs_disponiveis'),
    v_distrib_uh,
    public.consolidado_indicator(_closing_id, v_version, 'gop'),
    CASE WHEN v_fundo IS NULL THEN NULL ELSE abs(v_fundo) END,
    now()
  )
  ON CONFLICT (hotel_id, year, month) DO UPDATE SET
    closing_id = EXCLUDED.closing_id,
    status_dre = EXCLUDED.status_dre,
    ocupacao = EXCLUDED.ocupacao,
    adr = EXCLUDED.adr,
    revpar = EXCLUDED.revpar,
    receita_bruta = EXCLUDED.receita_bruta,
    taxa_fee = EXCLUDED.taxa_fee,
    incentive_fee = EXCLUDED.incentive_fee,
    distribuicao_total = EXCLUDED.distribuicao_total,
    uhs_disponiveis = EXCLUDED.uhs_disponiveis,
    distribuicao_por_uh = EXCLUDED.distribuicao_por_uh,
    gop = EXCLUDED.gop,
    fundo_reserva = EXCLUDED.fundo_reserva,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_consolidado_cache(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidado_line_value(uuid, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidado_has_line(uuid, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidado_indicator(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidado_indicator_by_pattern(uuid, integer, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_consolidado_cache(uuid) TO service_role;

-- 4) Triggers síncronos

CREATE OR REPLACE FUNCTION public.trg_consolidado_from_dre_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_consolidado_cache(COALESCE(NEW.closing_id, OLD.closing_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dre_versions_refresh_consolidado ON public.dre_versions;
CREATE TRIGGER dre_versions_refresh_consolidado
AFTER INSERT OR UPDATE OR DELETE ON public.dre_versions
FOR EACH ROW EXECUTE FUNCTION public.trg_consolidado_from_dre_version();

-- dre_parsed_lines: inserção em lote → trigger por comando (transition table)
CREATE OR REPLACE FUNCTION public.trg_consolidado_from_parsed_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT closing_id FROM changed_rows WHERE closing_id IS NOT NULL LOOP
    PERFORM public.recalc_consolidado_cache(r.closing_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dre_parsed_lines_refresh_consolidado_ins ON public.dre_parsed_lines;
CREATE TRIGGER dre_parsed_lines_refresh_consolidado_ins
AFTER INSERT ON public.dre_parsed_lines
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_consolidado_from_parsed_lines();

DROP TRIGGER IF EXISTS dre_parsed_lines_refresh_consolidado_upd ON public.dre_parsed_lines;
CREATE TRIGGER dre_parsed_lines_refresh_consolidado_upd
AFTER UPDATE ON public.dre_parsed_lines
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_consolidado_from_parsed_lines();

DROP TRIGGER IF EXISTS dre_parsed_lines_refresh_consolidado_del ON public.dre_parsed_lines;
CREATE TRIGGER dre_parsed_lines_refresh_consolidado_del
AFTER DELETE ON public.dre_parsed_lines
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_consolidado_from_parsed_lines();

-- closings: status_dre / distribuições alimentam o cache
CREATE OR REPLACE FUNCTION public.trg_consolidado_from_closing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_consolidado_cache(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS closings_refresh_consolidado ON public.closings;
CREATE TRIGGER closings_refresh_consolidado
AFTER INSERT OR UPDATE OF status_dre, final_distribution, estimated_distribution
ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.trg_consolidado_from_closing();

-- hotels.num_apartments afeta Distrib./UH
CREATE OR REPLACE FUNCTION public.trg_consolidado_from_hotel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.closings WHERE hotel_id = NEW.id LOOP
    PERFORM public.recalc_consolidado_cache(r.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hotels_refresh_consolidado ON public.hotels;
CREATE TRIGGER hotels_refresh_consolidado
AFTER UPDATE OF num_apartments ON public.hotels
FOR EACH ROW EXECUTE FUNCTION public.trg_consolidado_from_hotel();

-- 5) Backfill
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.closings LOOP
    PERFORM public.recalc_consolidado_cache(r.id);
  END LOOP;
END $$;