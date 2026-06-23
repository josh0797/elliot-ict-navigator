# Plan: Operational View, Decision Card & Setup Lifecycle (Phase 15–21)

Scope is large. I'll deliver it as 4 self-contained increments, each one compiling and with passing tests before moving on. The work touches only the chart route, chart components, the existing decision engine output, and `setups.functions.ts` snapshot persistence. No new backends, no new schemas to migrate.

## 1. Chart rendering modes — Operational vs Diagnostic

Add a `ChartViewMode = "operational" | "diagnostic"` toggle controlled in `chart.$symbol.tsx` (default `operational`).

`TradingChart` receives `viewMode` plus the already-available `signal` and `ict` props and renders:

- **Operational** (only the active setup's geometry, drawn from `signal`):
  - Entry zone — translucent blue/orange rectangle (`entryZone.top/bottom`).
  - Trigger — yellow dotted price line, label `WAIT FOR CHoCH` / `WAIT FOR SWEEP` / `RETEST POI`, etc.
  - SL — red dashed line + translucent red band from entry to SL.
  - TP1/TP2/TP3 — green dotted lines + translucent green band from entry to TP1. Labels come from `targets[]`.
  - Target liquidity — green solid line for `tp1Source.liquidityId` / TP target liquidity only.
  - Selected POI — translucent rectangle (kind label: `OB` or `FVG`).
  - Invalidation — red dotted line (`signal.invalidation.price`).
  - Originating sweep — single marker on the candle of `signal` provenance.
- **Diagnostic**: current behavior (all Elliott / ICT layers, all liquidity, all sweeps). The existing `LayerControls` only affects Diagnostic mode.

All draw paths already guard `isFiniteNumber` / `isValidChartTime`; I'll reuse those helpers for the new bands and labels so `null`/`NaN`/`Infinity` never reach lightweight-charts.

## 2. Decision card (`DecisionBanner` rewrite)

Promote the banner to a large card at the top of the side panel with three visual states driven by `report.decision`:

- **BUY / SELL** (green/red): order type, status, entry zone, trigger description, SL, TP1/TP2/TP3 table with RR and liquidity reason, `scoreOut100/grade`, `nextAction`.
- **WAIT** (amber): inferred bias, the single concrete missing requirement (`report.missing[0]`), explicit "Cancelar escenario si …" derived from `invalidation`.
- **NO_TRADE** (muted): primary reason (`report.reasons[0]`, e.g. `ELLIOTT_INVALIDATED · W2_ORIGIN`), and a "buscando conteo alternativo" hint when alternates exist.

No new server fields are needed — everything comes from the existing `OperationalReport` + `TradeSignal` contract.

## 3. Noise reduction in Diagnostic liquidity

In `ict` rendering (Diagnostic only):

- Hide `MITIGATED` and `BROKEN` levels by default; surface them behind a "show historical" toggle in `LayerControls`.
- Cap visible levels: top 3 per side (BSL/SSL) ranked by:
  1. target of active setup → 2. touches → 3. PWH/PWL → 4. PDH/PDL → 5. swing → 6. session.
- Cluster levels within `0.25 × ATR` and render one label per cluster (label = strongest member).
- Sweeps older than `N=50` candles back hidden by default.

## 4. Setup lifecycle (snapshot-on-create)

In `src/lib/setups.functions.ts`:

- On detection, persist an immutable snapshot: `{ entry, sl, targets, trigger, scoreOut100, confluences, featureSnapshot, engineVersions, detectedAt }`.
- A separate live-status updater only mutates: `status`, `triggeredAt`, `tpHit[]`, `slHit`, `expiredAt`. Never re-derives entry / SL / TP after publication.
- Add `engineVersions` constant (already partially present as `modelVersion`) recording `{ elliott, ict, setup, decision }` semvers.

## 5. Tests

New / extended Vitest suites:

- `decision.test.ts`: invalidated Elliott → NO_TRADE; no POI → WAIT/NO_TRADE; sweep without CHoCH → `WAITING_FOR_STRUCTURE_SHIFT`; CHoCH without retest → `WAITING_FOR_RETRACE`; POI retest → BUY/SELL; conflict → WAIT; `score<45`→NO_TRADE; `45≤score<70`→WAIT; `score≥70`+trigger→BUY/SELL.
- `engine.test.ts` extension: bullish full chain (SSL sweep → bull CHoCH → bull OB → discount → SL<sweep → TP at BSL → `BUY_LIMIT`) + symmetric bearish; geometry invariants (`SL<entry<TP` long, `TP<entry<SL` short, RR sign, POI top/bottom validity, target-behind-entry rejected, swept liquidity not used as target).
- New `TradingChart.view-mode.test.tsx` (smoke test via jsdom + a fake `lightweight-charts` mock module) to assert: Operational mode draws ≤ N price lines; Diagnostic preserves existing layer count; `null`/`NaN` inputs never throw.

## Technical details

- Files to **create**:
  - `src/components/chart/ChartViewToggle.tsx`
  - `src/lib/detection/setup/snapshot.ts` (engineVersions + snapshot freezer)
  - `src/lib/detection/setup/__tests__/geometry.test.ts`
  - `src/components/chart/__tests__/TradingChart.view-mode.test.tsx`
- Files to **edit**:
  - `src/components/chart/TradingChart.tsx` (viewMode branching + setup geometry)
  - `src/components/chart/DecisionBanner.tsx` (three-state card)
  - `src/components/chart/LayerControls.tsx` (only enabled in Diagnostic)
  - `src/routes/_authenticated/chart.$symbol.tsx` (viewMode state + toggle placement)
  - `src/lib/setups.functions.ts` (snapshot vs status update separation)
  - `src/lib/detection/decision/__tests__/decision.test.ts` (new cases)
  - `src/lib/detection/setup/__tests__/engine.test.ts` (bearish symmetry + geometry)

## Out of scope (explicitly)

- No DB schema changes; snapshot freezing is in-memory + the existing supabase row writes already accept the enriched payload.
- No new chart library; everything stays on `lightweight-charts`.
- No legacy ML weight changes — decision weighting remains as previously agreed.

## Deliverable per the user's checklist

Each section (15–21) maps to one of the four increments above. The final response will include: real `bunx vitest run` output, real build status, and a screenshot of Operational View captured via Playwright against the running preview.

Confirm to proceed and I'll ship increment 1 (view-mode + decision card) first, then the rest sequentially.
