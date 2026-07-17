-- Remove policies that permitiam upload de avatares no bucket público 'system-assets'.
-- Avatares agora vivem no bucket privado 'user-avatars' (com URLs assinadas).
DROP POLICY IF EXISTS "avatars_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;