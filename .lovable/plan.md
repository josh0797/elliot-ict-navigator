## Adaptación a este proyecto

Tu plan describe un backend Python/FastAPI. Este proyecto es **TanStack Start + TypeScript + Lovable Cloud**. Reproduciré la **separación conceptual** que pides, pero en TS bajo `src/lib/detection/` (los motores ya viven ahí). No tocaré Supabase, el modelo logreg JS, ni los endpoints existentes (`scan-and-alert`, `evaluate-results`, `training.functions.ts`).

### Mapeo de estructura

```text
backend/services/indicators/atr.py       → src/lib/detection/indicators/atr.ts
backend/services/structure/pivots.py     → src/lib/detection/structure/pivots.ts
backend/services/structure/swings.py     → src/lib/detection/structure/swings.ts
backend/services/structure/market_*.py   → src/lib/detection/structure/market-structure.ts
backend/services/elliott/*.py            → src/lib/detection/elliott/{types,candidates,rules,scoring,engine}.ts
backend/services/ict/*.py                → src/lib/detection/ict/{fvg,order-blocks,liquidity,bos-choch,killzones,premium-discount,engine}.ts
backend/services/confluence/*.py         → src/lib/detection/confluence/{scoring,setup-builder}.ts
backend/services/schemas/analysis.py     → src/lib/detection/schemas/analysis.ts
backend/tests/*                          → src/lib/detection/__tests__/* (vitest)
```

Los archivos legacy actuales (`elliott.ts`, `ict.ts`, `zigzag.ts`, `engine.ts`) se mantienen y se marcan `@deprecated` hasta que la nueva pipeline tenga tests verdes. Solo entonces re-cableo `engine.ts` para delegar a los nuevos módulos, preservando el contrato `TradeSetup` (añadiendo campos nuevos compatibles).

### Fase 0 — Auditoría (esta entrega)

Entrega documentos sin tocar lógica:
- `docs/elliott-ict-current-audit.md` — clasificación funcionalidad por funcionalidad (Implementada / Parcial / Heurística / Duplicada / Ausente / Inconsistente) revisando `elliott.ts`, `ict.ts`, `zigzag.ts`, `engine.ts`, `model.ts`, `chart.$symbol.tsx`, `dashboard.tsx`, panels.
- `docs/elliott-ict-target-contract.md` — contrato objetivo de `Candle`, `Pivot`, `Swing`, `ElliottCount`, `ICTContext`, `Confluence`, `Setup`, y nuevos campos compatibles añadidos a `TradeSetup`.

### Fase 1 — Infraestructura común (esta entrega)

- **`schemas/analysis.ts`** — tipos canónicos (`Candle`, `Pivot` con `strength`/`atrDistance`/`confirmed`, `Swing`).
- **`indicators/atr.ts`** — `trueRange()` y `atr14()` con RMA de Wilder (no media simple).
- **`structure/pivots.ts`** — detección por fractales L/R configurable, umbral mínimo en múltiplos de ATR, alternancia H/L forzada, deduplicación de pivotes consecutivos del mismo tipo (conservar extremo), confirmación sin look-ahead, marca `confirmed` vs `provisional` para el último pivote sin barras a la derecha.
- **`structure/swings.ts`** — agregación a `MINOR` / `MAJOR` por magnitud ATR.
- **`structure/market-structure.ts`** — helpers HH/HL/LH/LL reusables.
- **Validación de velas** — `validateCandles()` con advertencias explícitas (high/low coherentes, timestamps ascendentes sin duplicados, precios finitos > 0).
- **Tests vitest** — ATR contra valores conocidos, pivotes en serie sintética, no-repaint con velas truncadas.

### Fase 2 — Elliott Engine (esta entrega)

- **`elliott/types.ts`** — `WaveLabel`, `WavePattern` (`IMPULSE`, `LEADING_DIAGONAL`, `ENDING_DIAGONAL`, `ZIGZAG`, `FLAT`, `SIMPLE_CORRECTION`, `UNKNOWN_CORRECTION`), `CountState` (`NO_COUNT`/`DEVELOPING`/`VALID`/`INVALIDATED`/`COMPLETED`).
- **`elliott/candidates.ts`** — genera múltiples secuencias candidatas (no solo los últimos 9 pivotes alternados), bullish + bearish, permite ciclos incompletos, devuelve principal + alternativos.
- **`elliott/rules.ts`** — Reglas 1-3 hard (W2 no supera origen W1; W3 nunca la más corta entre 1/3/5; W4 no solapa W1 salvo diagonal). Reglas 4-5 soft (alternancia W2/W4 y proporcionalidad Fibonacci) suman score, no invalidan.
- **`elliott/scoring.ts`** — puntúa por ratios Fib (W2: 0.382/0.5/0.618/0.786; W3: 1.0/1.618/2.618; W4: 0.236/0.382/0.5; W5: 0.618/1.0/1.618), alternancia, claridad.
- **`elliott/engine.ts`** — orquesta: pivotes → candidatos → reglas → score → devuelve `{ primary, alternatives[], state }`.
- **A-B-C correctivo** — detección de A/B/C tras impulso 0-5 (válido o en desarrollo), valida dirección alternada, B como retroceso, ratio A/C; clasifica en `ZIGZAG` / `FLAT` / `SIMPLE_CORRECTION` / `UNKNOWN_CORRECTION` (sin pretender detectar correctivos complejos en v1).
- **Tests vitest** — Reglas 1/2/3 con counts sintéticos válidos e invalidados; truncamiento; diagonal con solapamiento permitido; A-B-C bullish y bearish.

### Lo que **NO** entra en esta tanda

Fases ≥3 (ICT engine canónico, confluencias, setup builder, render del gráfico, exposición al modelo ML) las abro en mensajes posteriores tras aprobación de Fase 2. Tampoco re-cableo `engine.ts` ni la UI todavía: la pipeline nueva queda probada en aislamiento.

### Riesgo

El cambio es aditivo y los módulos viejos siguen sirviendo `detectSetup()` mientras tanto. Si quieres, en lugar de mantener ambos, marco un commit posterior para borrar `zigzag.ts`/`elliott.ts`/`ict.ts` viejos cuando la pipeline nueva esté integrada.
