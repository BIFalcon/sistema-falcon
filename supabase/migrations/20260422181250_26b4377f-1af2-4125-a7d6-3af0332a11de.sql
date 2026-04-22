-- =========================
-- ENUM de roles
-- =========================
CREATE TYPE public.app_role AS ENUM (
  'processos',
  'fernando',
  'controladoria',
  'gop',
  'ri',
  'financeiro',
  'gg'
);

-- =========================
-- Tabela: hotels
-- =========================
CREATE TABLE public.hotels (
  id text PRIMARY KEY,
  name text NOT NULL,
  brand text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

-- =========================
-- Tabela: profiles
-- =========================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================
-- Tabela: user_roles
-- =========================
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  assigned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================
-- Tabela: user_hotels
-- =========================
CREATE TABLE public.user_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hotel_id)
);

ALTER TABLE public.user_hotels ENABLE ROW LEVEL SECURITY;

-- =========================
-- Funções de segurança (SECURITY DEFINER) — evitam recursão em RLS
-- =========================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_master(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('processos', 'fernando')
  )
$$;

-- =========================
-- Trigger: cria profile automaticamente
-- =========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================
-- Trigger: updated_at em profiles
-- =========================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================
-- POLICIES — hotels
-- =========================
CREATE POLICY "hotels_select_any_role"
  ON public.hotels FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "hotels_master_write"
  ON public.hotels FOR ALL
  TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

-- =========================
-- POLICIES — profiles
-- =========================
CREATE POLICY "profiles_select_any_role"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_master_all"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

-- =========================
-- POLICIES — user_roles
-- =========================
CREATE POLICY "user_roles_select_any_role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "user_roles_master_insert"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_master(auth.uid()));

CREATE POLICY "user_roles_master_delete"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.is_master(auth.uid()));

-- =========================
-- POLICIES — user_hotels
-- =========================
CREATE POLICY "user_hotels_select_any_role"
  ON public.user_hotels FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "user_hotels_master_insert"
  ON public.user_hotels FOR INSERT
  TO authenticated
  WITH CHECK (public.is_master(auth.uid()));

CREATE POLICY "user_hotels_master_delete"
  ON public.user_hotels FOR DELETE
  TO authenticated
  USING (public.is_master(auth.uid()));

-- =========================
-- SEED — 21 hotéis
-- =========================
INSERT INTO public.hotels (id, name, brand) VALUES
  ('ibis-arcoverde',          'Ibis Arcoverde',                'ibis'),
  ('ibis-budget-barbacena',   'Ibis budget Barbacena',         'ibis-budget'),
  ('ibis-budget-divinopolis', 'Ibis budget Divinópolis',       'ibis-budget'),
  ('ibis-budget-itaperuna',   'Ibis budget Itaperuna',         'ibis-budget'),
  ('ibis-budget-manhuacu',    'Ibis budget Manhuaçu',          'ibis-budget'),
  ('ibis-budget-muriae',      'Ibis budget Muriaé',            'ibis-budget'),
  ('ibis-budget-patos',       'Ibis budget Patos',             'ibis-budget'),
  ('ibis-budget-petropolis',  'Ibis budget Petrópolis',        'ibis-budget'),
  ('ibis-budget-recife',      'Ibis budget Recife Jaboatão',   'ibis-budget'),
  ('ibis-budget-uberlandia',  'Ibis budget Uberlândia',        'ibis-budget'),
  ('ibis-caruaru',            'Ibis Caruaru',                  'ibis'),
  ('ibis-cuiaba',             'Ibis Cuiabá',                   'ibis'),
  ('ibis-juiz-de-fora',       'Ibis Juiz de Fora',             'ibis'),
  ('ibis-macae',              'Ibis Macaé',                    'ibis'),
  ('ibis-serra-talhada',      'Ibis Serra Talhada',            'ibis'),
  ('ibis-styles-confins',     'Ibis Styles Confins',           'ibis-styles'),
  ('ibis-styles-garanhuns',   'Ibis Styles Garanhuns',         'ibis-styles'),
  ('ibis-styles-tres-rios',   'Ibis Styles Três Rios',         'ibis-styles'),
  ('manhattan-poa',           'Manhattan Porto Alegre',        'manhattan'),
  ('mercure-macae',           'Mercure Macaé',                 'mercure'),
  ('pousada-carneiros',       'Pousada Carneiros',             'pousada');