ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles SET status = 'active' WHERE email = 'halana.quintao@accor.com' AND status = 'pending';
UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'halana.quintao@accor.com' AND email_confirmed_at IS NULL;
ALTER TABLE public.profiles ENABLE TRIGGER USER;