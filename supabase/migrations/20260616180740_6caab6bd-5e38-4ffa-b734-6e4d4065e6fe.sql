CREATE POLICY "Password setup tokens are backend only"
ON public.password_setup_tokens
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);