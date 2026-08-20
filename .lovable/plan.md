# Plan: Second ML model family — SMC_M30 for XAU/USD (additive, non-breaking)

Goal: add an independent, scientifically validated SMC/liquidity + volatility + M30-timing model for XAU/USD, while the existing Elliott/ICT logistic regression stays untouched as the benchmark. No trading gate changes in phase 1.

## Conflicts found in the current code (must be resolved first)

1. `model_versions` is single-active globally. `src/lib/training.functions.ts` runs `update({ is_active: false }).eq("is_active", true)` across the whole table, and `src/lib/detection/model.ts` loads `.eq("is_active", true).maybeSingle()`. Training an SMC model today would silently deactivate the Elliott model and make `maybeSingle()` ambiguous.
2. Random shuffle + 80/20 split in `trainModel` (seeded LCG shuffle, then `slice(0.8)`). This leaks across time and is invalid for the SMC dataset.
3. Killzones are fixed UTC hours with no DST: `src/lib/detection/ict/killzones.ts` uses `ASIA 0-5, LONDON 7-10, NY_AM 12-15, NY_PM 18-20` on `getUTCHours()`. The empirical window (~06:00–07:59 London) sits *before* the code's LONDON zone in BST (05:00–07:00 UTC), so the current killzone label would mark the best window as "no killzone" or Asia. SMC features need their own DST-aware London-local clock, not `currentKillzone`.
4. Hard Elliott gate: `src/lib/detection/setup/engine.ts` returns `[]` when `pickOperativeCount()` is null, so an SMC candidate can never surface through the existing path. SMC candidate generation must be a separate generator, not a patch of this engine.
5. Only hourly granularity exists for killzone/session features; SMC needs minute-level session and M30-boundary features plus a fast lower-timeframe invalidation series.
6. `ml/dataset.ts` feature builder is Elliott-specific and its `FeatureSpec` (z-score tail) is reused by `detection/model.ts`. SMC gets its own schema module; do not extend these.

## Phase 0 — Schema/data-model (migration)

Migration 1 (additive, backwards compatible):
- `ALTER TABLE public.model_versions ADD COLUMN family text NOT NULL DEFAULT 'ELLIOTT_BASELINE'` (allowed values via check-free text + app-level enum: `ELLIOTT_BASELINE`, `SMC_M30`, `ENSEMBLE`).
- `ADD COLUMN feature_schema_version integer NOT NULL DEFAULT 1`, `ADD COLUMN train_window jsonb NOT NULL DEFAULT '{}'` (train/val/test date ranges), `ADD COLUMN calibration jsonb NOT NULL DEFAULT '{}'` (Platt/isotonic params).
- Replace global uniqueness with per-family: `CREATE UNIQUE INDEX model_versions_one_active_per_family ON public.model_versions (family) WHERE is_active`; also make `version` unique per family (`UNIQUE (family, version)`).
- Backfill: existing v1 becomes `family='ELLIOTT_BASELINE'` and stays active.

Migration 2 (new tables, each with the 4-step CREATE/GRANT/RLS/POLICY structure, admin-only writes mirroring `model_versions` policies):
- `smc_labeled_trades` — imported SONIC trades: symbol, direction, entry_time, entry_price, exit_time, exit_price, lots, result, source, external_id (unique), raw jsonb.
- `smc_training_rows` — one row per labeled trade: trade_id, symbol, entry_time, regime (`LIQUIDITY_REVERSAL`|`MOMENTUM_CONTINUATION`|`UNKNOWN`), feature_schema_version, features jsonb, feature_vector numeric[], labels jsonb (win, mfe_atr, mae_atr, time_to_positive_displacement_s, time_to_invalidation_s, duration_s, fav_before_adv), split (`TRAIN`|`VAL`|`TEST`), data_provenance jsonb (provider, bar count, last bar time used).
- `smc_predictions` (optional, phase 3) — live diagnostic log: symbol, timeframe, decided_at, regime, probability, features hash, model version.

## Phase 1 — SMC feature schema (new code, isolated)

New directory `src/lib/ml/smc/`:
- `clock.ts` — DST-aware London-local minute-of-day, session labels, minutes since M30 boundary, day-of-week, first-trade-of-day / first-M30-of-session flags. Uses IANA `Europe/London` via `Intl.DateTimeFormat`; no reuse of `killzones.ts`.
- `features.ts` — pure `buildSmcFeatures(ctx): SmcFeatureRow`, schema version 1, fixed ordered `SMC_FEATURE_NAMES`. Candidate groups:
  - Timing: london_minute (sin/cos encoded), minutes_from_m30, in_0_15_after_m30, is_first_trade_of_day, session one-hots (ASIA/LONDON_PRE/LONDON/NY).
  - Volatility: atr14, atr_ratio_fast_slow, bar_range/atr, range_expansion/atr, velocity and range acceleration over last 3/5 bars.
  - Liquidity: BSL/SSL sweep flags, sweep quality (wick_beyond/atr, close_back bool, bars_since), distance to nearest swing/atr, Asia high/low distance and swept flags, PDH/PDL distance and swept flags.
  - Displacement/structure: displacement magnitude/atr, direction agreement, BOS/CHoCH direction + bars_since, FVG created/mitigated + size/atr + distance/atr, OB state (fresh/mitigated) + distance/atr, premium/discount position (0..1).
  - Candle shape: upper/lower wick to body ratios, body/range, consecutive same-direction closes.
  - Explicitly excluded in v1: RSI, EMA, Elliott counts, wave degrees (reserved as later ablation-only features).
- `regimes.ts` — candidate generation, two mutually exclusive classes: `LIQUIDITY_REVERSAL` (sweep of a level + close-back + opposite displacement) and `MOMENTUM_CONTINUATION` (range expansion + directional closes + no sweep-reversal against direction). Same feature vector for both; regime is a categorical feature and also a grouping key for metrics.
- `logreg-smc.ts` — reuse `@/lib/ml/logreg` training core, but with its own spec type (`SmcFeatureSpec`) and chronological split, plus Platt calibration on the validation window.

## Phase 2 — Dataset construction without look-ahead leakage

- `src/lib/ml/smc/dataset.server.ts` — for each labeled trade: fetch M1/M5/M30 XAU/USD history via existing `providers.server.ts` cache, then **hard-truncate every series to bars with `close_time <= entry_time`** before calling `buildSmcFeatures`. The truncation happens once, in one place, and every feature receives only the truncated arrays (no raw series passed through).
- Labels are computed from a *separate*, post-entry slice (`entry_time < t <= entry_time + horizon`), never handed to the feature builder. Types enforce this: `FeatureWindow` and `OutcomeWindow` are distinct branded types.
- Provenance stored per row (provider, first/last bar timestamps) so any row can be re-derived and audited.
- Guardrails: reject rows where the last feature bar is closer than one bar-interval to entry, or where required history (e.g. 200 M5 bars) is missing.

## Phase 3 — Targets

Per trade, computed from the outcome window on M1 where available:
- `win` (primary binary), `mfe_atr`, `mae_atr`, `time_to_positive_displacement_s`, `time_to_invalidation_s`, `duration_s`.
- `fav_before_adv`: 1 if +kR excursion occurs before -1R (k configurable, default 1.0) — the preferred calibrated target since it is stop/target-policy agnostic.
- v1 trains `fav_before_adv`; `win` is trained as a secondary head for comparability with the Elliott benchmark.

## Phase 4 — Chronological validation and metrics

- Split by entry_time: earliest 60% TRAIN, next 20% VAL (used for calibration + threshold selection), latest 20% TEST (touched once). Split boundaries recorded in `train_window`.
- Optional walk-forward: expanding-window folds, reported alongside the single split.
- Metrics module `src/lib/ml/smc/metrics.ts`: precision, recall, F1, ROC-AUC, PR-AUC, Brier score, reliability curve (10 buckets), expectancy and profit factor per probability bucket, and baseline prevalence for comparison. Metrics reported overall and split by regime and by session window.
- Explicit warning surfaced in the UI when TEST prevalence differs materially from TRAIN (the 86.7% in-sample win rate is a strong selection-bias risk).

## Phase 5 — Live diagnostic scorer (no gate)

- `src/lib/ml/smc/scorer.server.ts` — `loadActiveModel(family)` refactor in `src/lib/detection/model.ts` so the cache is keyed by family; `scoreSmc(candles, ctx)` returns `{ probability, regime, calibrated, modelVersion }` or null.
- `analysis.server.ts` returns an optional `smc` diagnostic block; `analysis-schemas.ts` extends with an optional field (backwards compatible with older clients).
- UI: show SMC probability + regime as a badge/row in `SignalsPanel` / `ScenariosPanel` next to the canonical score and Elliott model score. `setup/engine.ts` behaviour is unchanged in this phase — Elliott hard gate stays exactly as is.

## Phase 6 — Ensemble (only after SMC passes out-of-sample)

- New `family='ENSEMBLE'`: stacked logistic layer over {elliott_prob, smc_prob, regime, session flags}, trained on the intersection of labeled rows, validated on the same TEST window. Only after ENSEMBLE beats both singles on PR-AUC and calibration do we discuss allowing SMC-only candidates through a trading path (separate future decision, with the Elliott gate made regime-aware rather than removed).

## Files/tables/routes touched

New: `src/lib/ml/smc/{clock,features,regimes,logreg-smc,metrics,dataset.server,scorer.server}.ts`, `src/lib/smc-training.functions.ts` (thin wrappers: `importSonicTrades`, `buildSmcDataset`, `trainSmcModel`, `evaluateSmcModel`), `src/routes/_authenticated/smc-training.tsx`, tests under `src/lib/ml/smc/__tests__/`.
Modified: `src/lib/detection/model.ts` (family-keyed load), `src/lib/training.functions.ts` (scope the deactivation to `family='ELLIOTT_BASELINE'`, and switch its split to chronological only if a date column is available — otherwise leave untouched and document), `analysis.server.ts` + `analysis-schemas.ts` (optional `smc` block), `SignalsPanel`.
Tables: `model_versions` (new columns + per-family active index), `smc_labeled_trades`, `smc_training_rows`, `smc_predictions`.

## Tests

- `clock.test.ts`: London BST/GMT boundaries, M30 offsets, first-trade flags.
- `leakage.test.ts`: synthetic series where post-entry bars are extreme — asserts feature vector is byte-identical with and without those bars.
- `regimes.test.ts`: reversal vs continuation classification on hand-built fixtures.
- `metrics.test.ts`: known-value checks for AUC, PR-AUC, Brier, bucket expectancy.
- `dataset.test.ts`: label correctness for MFE/MAE/fav_before_adv, and rejection of insufficient-history rows.
- Regression: existing Elliott model still loads and scores after the migration (family default backfill).

## Risks

- **Selection bias**: 86.7% win rate from a curated public account is unlikely to be reproducible; the model may learn "this account's trades" rather than edge. Mitigated by out-of-sample TEST and by reporting prevalence vs. metrics.
- **Small n**: 406 trades, 108 in the key window. High variance; the 96.3% sub-window is ~82 trades and cannot support many features. Keep v1 feature count small (target ≤ 25 after pruning) and prefer regularized logistic regression over anything deeper.
- **No negative sampling**: labeled data contains only trades taken. A win/loss model conditioned on "trade was taken" cannot answer "should I take a trade". Phase 2 should additionally generate unlabeled candidate rows from history for later negative sampling; noted as a known limitation of v1.
- **Timestamp/timezone ambiguity**: the Myfxbook→London mapping is inferred from price matching. If wrong, timing features shift by hours. Verify by re-deriving the mapping from OHLC price matching inside the importer and storing the resolved offset per trade.
- **Provider granularity**: M1/tick history for XAU/USD may be unavailable or gappy from current providers, which weakens the fast invalidation layer and MFE/MAE precision. Fall back to M5 with recorded provenance and flag affected rows.
- **Migration risk**: the partial unique index will fail if more than one row is already active per family; migration must assert exactly one active row first.
