CREATE TABLE public.password_setup_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.password_setup_tokens TO service_role;

ALTER TABLE public.password_setup_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_password_setup_tokens_hash ON public.password_setup_tokens(token_hash);
CREATE INDEX idx_password_setup_tokens_user_active ON public.password_setup_tokens(user_id, used_at, expires_at);