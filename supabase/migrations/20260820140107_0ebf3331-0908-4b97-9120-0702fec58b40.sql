CREATE TABLE public.pre_raid_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  detector_version text NOT NULL,
  symbol text NOT NULL DEFAULT 'XAU/USD',
  candidate_at timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long','short')),
  reference_price numeric NOT NULL,
  atr_m5 numeric NOT NULL,
  setup_score numeric NOT NULL CHECK (setup_score >= 0 AND setup_score <= 1),
  component_count smallint NOT NULL CHECK (component_count >= 0 AND component_count <= 5),
  dist_liquidity numeric,
  approach_velocity numeric,
  micro_pullback numeric,
  asia_position numeric,
  raid_state text,
  minutes_since_relevant_raid_norm numeric,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  london_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  source_last_closed_at timestamptz,
  outcome_1m jsonb,
  outcome_3m jsonb,
  outcome_5m jsonb,
  outcome_15m jsonb,
  outcomes_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pre_raid_observations_unique UNIQUE (detector_version, symbol, candidate_at, direction)
);

COMMENT ON TABLE public.pre_raid_observations IS 'Diagnostic-only prospective research rows for PRE_RAID_APPROACH_V1 (SONIC-likeness). setup_score is setup-likeness, NEVER a win probability. Never used for gating, alerts or trading decisions.';
COMMENT ON COLUMN public.pre_raid_observations.provider IS 'Data provenance only. Never a model feature.';

GRANT SELECT ON public.pre_raid_observations TO authenticated;
GRANT ALL ON public.pre_raid_observations TO service_role;

ALTER TABLE public.pre_raid_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pre_raid_observations readable by auth"
  ON public.pre_raid_observations
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX pre_raid_observations_symbol_candidate_idx
  ON public.pre_raid_observations (symbol, candidate_at DESC);
CREATE INDEX pre_raid_observations_pending_outcomes_idx
  ON public.pre_raid_observations (candidate_at DESC)
  WHERE outcome_15m IS NULL;
CREATE INDEX pre_raid_observations_score_idx
  ON public.pre_raid_observations (setup_score DESC, candidate_at DESC);

CREATE TRIGGER pre_raid_observations_touch
  BEFORE UPDATE ON public.pre_raid_observations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();