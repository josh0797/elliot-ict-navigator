
-- 1) model_versions: restrict reads to admins only
DROP POLICY IF EXISTS "models readable" ON public.model_versions;
CREATE POLICY "admins read model_versions"
  ON public.model_versions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Remove unused alerts table from realtime publication (app subscribes to setups only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.alerts';
  END IF;
END $$;

-- 3) Lock down has_role: revoke direct execute from public/authenticated/anon.
-- RLS policies that need it can call it via service_role / definer chain.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
