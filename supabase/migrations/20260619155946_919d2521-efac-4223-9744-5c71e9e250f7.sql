
ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_active
  ON public.model_versions ((is_active)) WHERE is_active;

DROP POLICY IF EXISTS "admins insert model_versions" ON public.model_versions;
CREATE POLICY "admins insert model_versions" ON public.model_versions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admins update model_versions" ON public.model_versions;
CREATE POLICY "admins update model_versions" ON public.model_versions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admins delete model_versions" ON public.model_versions;
CREATE POLICY "admins delete model_versions" ON public.model_versions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Promote existing single account to admin
INSERT INTO public.user_roles (user_id, role)
SELECT '493a89af-31ff-40c5-a669-0ee2090617e2'::uuid, 'admin'::public.app_role
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = '493a89af-31ff-40c5-a669-0ee2090617e2'::uuid AND role = 'admin'
);
