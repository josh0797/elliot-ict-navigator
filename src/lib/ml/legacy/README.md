# legacy-pretrained-html-v1

Frozen baseline scorer ported from `elliott-ict-pro2.html` (`MLEngine.PRETRAINED`).

- Architecture: 6 → 12 (ReLU) → Dropout(0.15, off at inference) → 8 (ReLU) → 1 (sigmoid)
- Samples: 698 · accuracy_test: 52.86% · dataset win-rate: 49.71%
- Features are **proxies**, not canonical Elliott/ICT signals. See `LEGACY_WARNINGS`.

## Do

- Use `scoreLegacy(input)` for shadow logging and side-by-side comparison.
- Treat outputs as a baseline only.

## Do not

- Wire into `loadActiveModel()` / `scoreSetupML()` / `logreg` training pipeline.
- Retrain. Modify formulas. Modify weights. Modify `minNorm`/`maxNorm`.
- Reuse waveCode ordinal mapping in `canonical-ict-v2`.

`canonical-ict-v2` lives elsewhere, uses real Elliott/ICT features, trains from
scratch, and stays in shadow mode until promoted.