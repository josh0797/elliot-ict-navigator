
DROP POLICY IF EXISTS "admins read model_versions" ON public.model_versions;
CREATE POLICY "admins read model_versions"
  ON public.model_versions
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ));
