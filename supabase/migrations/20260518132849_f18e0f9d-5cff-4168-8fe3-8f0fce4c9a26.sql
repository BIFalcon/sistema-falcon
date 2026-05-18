
-- ============ ROLES ============
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'comercial';

COMMIT;

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.is_rh_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master(_user_id) OR public.has_role(_user_id, 'rh'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_rh_content(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'rh'::app_role)
      OR public.has_role(_user_id, 'marketing'::app_role);
$$;

-- ============ TABLES ============

-- 1) rh_uploads
CREATE TABLE public.rh_uploads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  detected_format text,
  parsed_count integer,
  parse_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rh_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_uploads_select ON public.rh_uploads FOR SELECT TO authenticated
USING (
  public.is_rh_manager(auth.uid())
  OR (hotel_id IS NOT NULL AND public.has_role(auth.uid(), 'gg'::app_role) AND public.is_hotel_allowed(auth.uid(), hotel_id))
);
CREATE POLICY rh_uploads_insert ON public.rh_uploads FOR INSERT TO authenticated
WITH CHECK (public.is_rh_manager(auth.uid()) AND uploaded_by = auth.uid());
CREATE POLICY rh_uploads_delete ON public.rh_uploads FOR DELETE TO authenticated
USING (public.is_rh_manager(auth.uid()));

-- 2) rh_employees
CREATE TABLE public.rh_employees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL,
  upload_id uuid,
  employee_key text NOT NULL,
  name text NOT NULL,
  cpf text,
  position text,
  department text,
  gender text,
  birth_date date,
  admission_date date,
  termination_date date,
  termination_reason text,
  salary numeric,
  status text NOT NULL DEFAULT 'ativo',
  source_format text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rh_employees_key_idx ON public.rh_employees(hotel_id, employee_key);
CREATE INDEX rh_employees_hotel_idx ON public.rh_employees(hotel_id);
CREATE INDEX rh_employees_status_idx ON public.rh_employees(status);
ALTER TABLE public.rh_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_employees_select ON public.rh_employees FOR SELECT TO authenticated
USING (
  public.is_rh_manager(auth.uid())
  OR (public.has_role(auth.uid(), 'gg'::app_role) AND public.is_hotel_allowed(auth.uid(), hotel_id))
);
CREATE POLICY rh_employees_write ON public.rh_employees FOR ALL TO authenticated
USING (public.is_rh_manager(auth.uid()))
WITH CHECK (public.is_rh_manager(auth.uid()));

CREATE TRIGGER rh_employees_touch BEFORE UPDATE ON public.rh_employees
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) rh_calendar_dates
CREATE TABLE public.rh_calendar_dates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_day integer NOT NULL CHECK (date_day BETWEEN 1 AND 31),
  date_month integer NOT NULL CHECK (date_month BETWEEN 1 AND 12),
  title text NOT NULL,
  category text NOT NULL DEFAULT 'informativo',
  recurring boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_calendar_dates_month_idx ON public.rh_calendar_dates(date_month, date_day);
ALTER TABLE public.rh_calendar_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_calendar_dates_select ON public.rh_calendar_dates FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_calendar_dates_write ON public.rh_calendar_dates FOR ALL TO authenticated
USING (public.can_edit_rh_content(auth.uid()))
WITH CHECK (public.can_edit_rh_content(auth.uid()));

-- 4) rh_calendar_posts
CREATE TABLE public.rh_calendar_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_id uuid NOT NULL REFERENCES public.rh_calendar_dates(id) ON DELETE CASCADE,
  year integer NOT NULL,
  title text NOT NULL,
  content text,
  status text NOT NULL DEFAULT 'planejado',
  media_url text,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_calendar_posts_date_idx ON public.rh_calendar_posts(date_id, year);
ALTER TABLE public.rh_calendar_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_calendar_posts_select ON public.rh_calendar_posts FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_calendar_posts_insert ON public.rh_calendar_posts FOR INSERT TO authenticated
WITH CHECK (public.can_edit_rh_content(auth.uid()) AND author_id = auth.uid());
CREATE POLICY rh_calendar_posts_update ON public.rh_calendar_posts FOR UPDATE TO authenticated
USING (public.can_edit_rh_content(auth.uid()) AND (author_id = auth.uid() OR public.is_rh_manager(auth.uid())));
CREATE POLICY rh_calendar_posts_delete ON public.rh_calendar_posts FOR DELETE TO authenticated
USING (public.is_rh_manager(auth.uid()) OR author_id = auth.uid());

CREATE TRIGGER rh_calendar_posts_touch BEFORE UPDATE ON public.rh_calendar_posts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) rh_org_nodes
CREATE TABLE public.rh_org_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id uuid REFERENCES public.rh_org_nodes(id) ON DELETE CASCADE,
  name text NOT NULL,
  position text,
  department text,
  hotel_id text,
  photo_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_open_position boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_org_nodes_parent_idx ON public.rh_org_nodes(parent_id);
ALTER TABLE public.rh_org_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_org_nodes_select ON public.rh_org_nodes FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_org_nodes_write ON public.rh_org_nodes FOR ALL TO authenticated
USING (public.is_rh_manager(auth.uid()))
WITH CHECK (public.is_rh_manager(auth.uid()));

CREATE TRIGGER rh_org_nodes_touch BEFORE UPDATE ON public.rh_org_nodes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6) rh_org_responsibilities
CREATE TABLE public.rh_org_responsibilities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES public.rh_org_nodes(id) ON DELETE CASCADE,
  description text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_org_resp_node_idx ON public.rh_org_responsibilities(node_id);
ALTER TABLE public.rh_org_responsibilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_org_resp_select ON public.rh_org_responsibilities FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_org_resp_write ON public.rh_org_responsibilities FOR ALL TO authenticated
USING (public.is_rh_manager(auth.uid()))
WITH CHECK (public.is_rh_manager(auth.uid()));

-- 7) rh_trainings
CREATE TABLE public.rh_trainings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  category text,
  media_url text,
  duration_minutes integer,
  mandatory boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rh_trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_trainings_select ON public.rh_trainings FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_trainings_write ON public.rh_trainings FOR ALL TO authenticated
USING (public.can_edit_rh_content(auth.uid()))
WITH CHECK (public.can_edit_rh_content(auth.uid()));

CREATE TRIGGER rh_trainings_touch BEFORE UPDATE ON public.rh_trainings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 8) rh_policies
CREATE TABLE public.rh_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  content text,
  category text,
  document_url text,
  version text,
  published boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rh_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY rh_policies_select ON public.rh_policies FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));
CREATE POLICY rh_policies_write ON public.rh_policies FOR ALL TO authenticated
USING (public.can_edit_rh_content(auth.uid()))
WITH CHECK (public.can_edit_rh_content(auth.uid()));

CREATE TRIGGER rh_policies_touch BEFORE UPDATE ON public.rh_policies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SEED: 43 DATAS COMEMORATIVAS ============
INSERT INTO public.rh_calendar_dates (date_day, date_month, title, category) VALUES
(20, 1, 'Dia Internacional do RH', 'informativo'),
(23, 1, 'Janeiro Branco - Saúde Mental', 'acao_interna'),
(4, 2, 'Dia Mundial Contra o Câncer', 'informativo'),
(13, 2, 'Carnaval - Bloquinho da Falcon', 'acao_interna'),
(22, 2, 'Dia do Auxiliar de Serviços Gerais', 'informativo'),
(1, 3, 'Março Lilás - Câncer do Colo do Útero', 'informativo'),
(8, 3, 'Dia Internacional da Mulher', 'acao_interna'),
(14, 3, 'Dia Nacional dos Animais', 'informativo'),
(5, 4, 'Páscoa', 'acao_interna'),
(25, 4, 'Dia da Contabilidade', 'informativo'),
(1, 5, 'Dia do Trabalhador', 'acao_interna'),
(1, 5, 'Maio Amarelo - Trânsito', 'informativo'),
(8, 5, 'Dia do Profissional de Marketing', 'informativo'),
(8, 5, 'Dia Nacional do Turismo', 'informativo'),
(10, 5, 'Dia das Mães', 'acao_interna'),
(10, 5, 'Dia da Cozinheira', 'informativo'),
(10, 5, 'Dia do Guia de Turismo', 'informativo'),
(13, 5, 'Dia Nacional do Chefe de Cozinha', 'informativo'),
(1, 6, 'Junho Vermelho - Doação de Sangue', 'informativo'),
(6, 6, 'Festa Junina', 'acao_interna'),
(11, 6, 'Copa do Mundo', 'acao_interna'),
(10, 7, 'Dia da Pizza', 'informativo'),
(1, 8, 'Dia do Advogado', 'informativo'),
(2, 8, 'Início da Semana da Cultura Nordestina', 'acao_interna'),
(5, 8, 'Dia Nacional da Saúde', 'informativo'),
(9, 8, 'Dia dos Pais', 'acao_interna'),
(11, 8, 'Dia do Garçom', 'informativo'),
(13, 8, 'Dia do Economista', 'informativo'),
(18, 8, 'Dia do Estagiário', 'informativo'),
(4, 9, 'Setembro Amarelo', 'acao_interna'),
(9, 9, 'Dia do Administrador', 'informativo'),
(15, 9, 'Dia do Cliente', 'informativo'),
(22, 9, 'Dia do Contador', 'informativo'),
(27, 9, 'Dia Nacional do Turismólogo', 'informativo'),
(30, 9, 'Dia da Secretária', 'informativo'),
(1, 10, 'Dia do Vendedor', 'informativo'),
(2, 10, 'Outubro Rosa - Câncer de Mama', 'acao_interna'),
(12, 10, 'Dia das Crianças', 'acao_interna'),
(31, 10, 'Halloween', 'acao_interna'),
(6, 11, 'Novembro Azul - Câncer de Próstata', 'acao_interna'),
(9, 11, 'Dia do Hoteleiro', 'acao_interna'),
(20, 11, 'Consciência Negra', 'informativo'),
(25, 12, 'Natal', 'acao_interna');

-- ============ SEED: ORGANOGRAMA ============
-- CEO
WITH ceo AS (
  INSERT INTO public.rh_org_nodes (name, position, department, sort_order)
  VALUES ('Fernando Fonseca', 'CEO', 'Diretoria', 0) RETURNING id
),
-- 7 lideranças matriz
lid AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, sort_order, is_open_position)
  SELECT (SELECT id FROM ceo), v.name, v.pos, v.dept, v.ord, v.open
  FROM (VALUES
    ('Fabio', 'Controller', 'Controladoria', 1, false),
    ('Raquel', 'Coordenadora', 'Financeiro', 2, false),
    ('Leandro', 'Diretor', 'Novos Negócios', 3, false),
    ('Rafael Cunha', 'Gerente', 'Processos', 4, false),
    ('Vaga Aberta', 'Coordenadora', 'RH', 5, true),
    ('Rafael Pinheiro', 'Diretor', 'Comercial - RM', 6, false),
    ('Rafaela', 'Coordenadora', 'Marketing', 7, false),
    ('Henrique Batista', 'Gerente de Operações', 'Operações', 8, false),
    ('Geraldo Magela', 'Gerente de Operações', 'Operações', 9, false),
    ('Livia Soares', 'Gerente de Operações', 'Operações', 10, false)
  ) AS v(name, pos, dept, ord, open)
  RETURNING id, name, department
),
-- Liderados Controladoria
ctrl AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Fabio'), v.name, v.pos, 'Controladoria', v.ord
  FROM (VALUES
    ('Fernando Oliveira', 'Analista de Controladoria Sr', 1),
    ('José', 'Analista de Controladoria Sr', 2),
    ('Victor', 'Analista de Controladoria Pleno', 3),
    ('Karla', 'Assistente de Controladoria', 4),
    ('Arthur', 'Analista de Controladoria Jr', 5)
  ) AS v(name, pos, ord)
  RETURNING id
),
-- Liderados Financeiro
fin AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Raquel'), v.name, v.pos, 'Financeiro', v.ord
  FROM (VALUES
    ('Camila', 'Analista Financeiro Jr', 1),
    ('Mariana', 'Assistente Financeiro', 2),
    ('Barbara', 'Assistente Financeiro', 3)
  ) AS v(name, pos, ord)
  RETURNING id
),
-- Liderados Processos
proc AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Rafael Cunha'), v.name, v.pos, 'Processos', v.ord
  FROM (VALUES
    ('Stela', 'Analista de Operações', 1),
    ('Luiza', 'Analista de RI', 2),
    ('Barbara Rodrigues', 'Especialista Gestão Estratégica', 3)
  ) AS v(name, pos, ord)
  RETURNING id
),
-- Liderado RH
rh AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Vaga Aberta' AND department = 'RH'),
         'Jamily', 'Analista de RH', 'RH', 1
  RETURNING id
),
-- GGs sob Henrique
gg_h AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, hotel_id, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Henrique Batista'), v.name, 'Gerente Geral', 'Operações', v.hid, v.ord
  FROM (VALUES
    ('Joice Oliveira', 'ibis-budget-uberlandia', 1),
    ('Marcos', 'ibis-budget-itaperuna', 2),
    ('Halana Lima', 'ibis-juiz-de-fora', 3),
    ('Daniela Batista', 'manhattan-poa', 4),
    ('Ana Clara', 'ibis-budget-muriae', 5),
    ('Daniel Soares', 'ibis-budget-barbacena', 6),
    ('Flaviana Cunha', 'ibis-budget-manhuacu', 7),
    ('Fábio Moreira', 'ibis-cuiaba', 8)
  ) AS v(name, hid, ord)
  RETURNING id
),
-- GGs sob Geraldo
gg_g AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, hotel_id, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Geraldo Magela'), v.name, 'Gerente Geral', 'Operações', v.hid, v.ord
  FROM (VALUES
    ('Cristopher Felix', 'ibis-budget-petropolis', 1),
    ('Antonio', 'ibis-styles-tres-rios', 2),
    ('Wolney', 'mercure-macae', 3),
    ('João Gomide', 'ibis-budget-patos', 4),
    ('Silmara Carlos', 'ibis-budget-divinopolis', 5),
    ('Leticia Oliveira', 'ibis-styles-confins', 6),
    ('Wolney', 'ibis-macae', 7)
  ) AS v(name, hid, ord)
  RETURNING id
),
-- GGs sob Lívia
gg_l AS (
  INSERT INTO public.rh_org_nodes (parent_id, name, position, department, hotel_id, sort_order)
  SELECT (SELECT id FROM lid WHERE name = 'Livia Soares'), v.name, 'Gerente Geral', 'Operações', v.hid, v.ord
  FROM (VALUES
    ('João Carlos', 'ibis-serra-talhada', 1),
    ('João Paulo', 'ibis-arcoverde', 2),
    ('Emanuela Oliveira', 'ibis-caruaru', 3),
    ('João Cavalcanti', 'pousada-carneiros', 4),
    ('Bruno Reis', 'ibis-budget-recife', 5),
    ('Victor Areias', 'ibis-styles-garanhuns', 6)
  ) AS v(name, hid, ord)
  RETURNING id
)
SELECT 1;
