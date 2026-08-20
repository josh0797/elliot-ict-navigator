ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS family text NOT NULL DEFAULT 'ELLIOTT_BASELINE',
  ADD COLUMN IF NOT EXISTS feature_schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS train_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS calibration jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.model_versions SET family = 'ELLIOTT_BASELINE' WHERE family IS NULL OR family = '';

ALTER TABLE public.model_versions
  ADD CONSTRAINT model_versions_family_check
  CHECK (family IN ('ELLIOTT_BASELINE', 'SMC_M30', 'ENSEMBLE'));

DROP INDEX IF EXISTS public.model_versions_one_active;

ALTER TABLE public.model_versions DROP CONSTRAINT IF EXISTS model_versions_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_family_version_key
  ON public.model_versions (family, version);

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_active_per_family
  ON public.model_versions (family) WHERE is_active;