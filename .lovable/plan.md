# Plan — Cierre del esqueleto: señales operativas end-to-end

Objetivo: que la app deje de mostrar solo capas visuales y produzca **setups accionables** combinando el motor canónico (`detection/elliott` + `detection/ict`) con el scorer legacy congelado (`ml/legacy`). Sin reentrenar nada. Sin tocar tipos del contrato congelado.

## Alcance

1. **Motor de setups canónico v2** (`src/lib/detection/setup/engine.ts`)
   - Input: `candles`, `pivots`, `ElliottAnalysis`, `IctContext`.
   - Reglas de confluencia (todas opcionales y ponderadas, no hard-gates excepto invalidación):
     - Sesgo Elliott coincide con bias ICT (`BULLISH`/`BEARISH`).
     - Onda actual ∈ {2, 4, B} (zona de entrada) o impulso temprano (1/3/5 con sweep previo).
     - Confluencia con **Order Block FRESH/TOUCHED** en dirección, o **FVG no mitigado**.
     - **Liquidity sweep** reciente (≤5 velas) en lado opuesto.
     - Evento de estructura `BOS`/`CHoCH` CONFIRMED en dirección.
     - Premium/Discount alineado: longs en discount, shorts en premium.
     - Killzone activa (bonus, no requisito).
   - Output `TradeSetupV2` (extiende `TradeSetup` legacy con campos opcionales):
     - `entry` = borde de zona POI más cercano.
     - `sl` = extremo de la zona ± buffer ATR×0.1.
     - `tp1` = liquidez opuesta más cercana o 1R×2.
     - `tp2` = extensión Fib 1.618 de la onda dominante.
     - `confirmationLevel`, `invalidationLevel`, `fibTarget1` poblados para feature extractor legacy.
     - `scoreBreakdown { elliott, ict, confluence }`.
     - `rationale` (string en español, lista de confluencias activas).

2. **Conexión legacy → setup**
   - En el engine, tras construir el setup, llamar
     `scoreSignalLegacy(buildLegacyInput(signal, elliott, priceAtDetection))`
     y adjuntar:
     - `signal.mlScore` (0..1) — ACTIVE BASELINE, diagnóstico paralelo.
     - `signal.modelVersion = "legacy-pretrained-html-v1"`.
   - Helper `buildLegacyInput` en `src/lib/detection/setup/legacyAdapter.ts`
     mapea `(signal, elliott, currentPrice)` → `LegacyInput` con los **siete**
     campos reales del contrato:
     `confirmationLevel`, `invalidationLevel`, `fibTarget1`, `rrRatio`,
     `hasAlternative`, `currentPriceApprox`, `waveLabel`.
   - Invariante de contrato: `fibTarget1` y `rrRatio` deben referirse al
     **mismo** objetivo (TP1) para mantener coherentes las features legacy
     f0 (tp/sl) y f3 (rrNorm).
   - `currentPriceApprox` se congela como `priceAtDetection` (cierre de la
     última vela confirmada) y se guarda en el snapshot del signal, para que
     re-puntuar el mismo setup sea determinista.
   - Sin tocar `src/lib/ml/legacy/*` ni `model.ts`.

3. **Filtros y ranking de señales**
   - Descartar setup si:
     - RR (a TP1) < 1.0
     - Score canónico < 0.35
     - Elliott `state === "INVALIDATED"`
   - Score operativo (`finalScore`) = `canonicalScore`. El legacy NO pondera
     decisiones operativas en esta fase: 52.86% accuracy vs 49.71% base no
     justifica un peso fijo, y mezclar 40% podría degradar setups canónicos
     buenos. Se mantendrá como ACTIVE BASELINE en paralelo hasta que un
     backtest calibre un peso (máximo 0.1 inicialmente).
   - Devolver top-N (default 3) ordenados por `finalScore`.

4. **Server function**
   - Extender `src/lib/elliott.functions.ts` (o nueva `src/lib/setups.functions.ts`) con `detectSetups({ symbol, interval, outputsize })` que devuelve `{ setups: TradeSetupV2[], elliott, ict, provider }`.
   - Sin auth (paridad con `analyzeSymbol` actual).

5. **UI mínima en `chart.$symbol.tsx`**
   - Panel "Señales" debajo del chart:
     - Tarjeta por setup: dirección (chip), entry/SL/TP1/TP2, RR, score canónico, score ML, rationale, lista de confluencias.
     - Si no hay setups: estado vacío explicativo.
   - Líneas en el chart para el setup seleccionado: entry (azul), SL (rojo punteado), TP1/TP2 (verde punteado).
   - No tocar layers existentes ni el LayerControls.

6. **Tests**
   - `src/lib/detection/setup/__tests__/engine.test.ts`:
     - Fixture sintético bullish: pivotes en patrón impulsivo + OB bullish + sweep SSL → setup long con score > 0.5, RR > 1.
     - Fixture bearish simétrico.
     - Fixture sin confluencia → 0 setups.
     - Setup con Elliott INVALIDATED → descartado.
   - `src/lib/detection/setup/__tests__/legacyAdapter.test.ts`:
     - Verifica que el `LegacyInput` producido tenga los 4 campos requeridos y `fibTarget1` finito cuando hay tp2.
     - Verifica que `scoreLegacy` se invoca y devuelve 0..1.

## Fuera de alcance (explícito)

- No se reentrena modelo, no se crea `canonical-ict-v2`.
- No se modifica `src/lib/detection/types.ts` (legacy) ni `src/lib/detection/engine.ts` (legacy zigzag-based). Quedan como están para no romper consumidores existentes (`scan-and-alert`, etc.).
- No se cambian rutas, auth, ni esquema de BD.
- No se cambia el LayerControls ni el sistema de capas del chart.

## Archivos nuevos

- `src/lib/detection/setup/engine.ts`
- `src/lib/detection/setup/legacyAdapter.ts`
- `src/lib/detection/setup/types.ts` (re-exporta `TradeSetupV2` desde contract)
- `src/lib/detection/setup/__tests__/engine.test.ts`
- `src/lib/detection/setup/__tests__/legacyAdapter.test.ts`
- `src/lib/setups.functions.ts`
- `src/components/chart/SignalsPanel.tsx`

## Archivos modificados

- `src/routes/_authenticated/chart.$symbol.tsx` — montar `<SignalsPanel/>` y pasar setup seleccionado a `TradingChart`.
- `src/components/chart/TradingChart.tsx` — dibujar entry/SL/TP del setup activo (prop opcional, sin romper si es undefined).

## Riesgo

- El motor canónico hoy no expone `confirmationLevel`/`invalidationLevel` directamente; el adapter los deriva de `setup.entry` y `setup.sl`. Documentado en código.
- `fibTarget1` se toma de `tp1` (mismo target que `rrRatio`) para preservar
  la coherencia interna del vector legacy. Si falta, el extractor aplica el
  fallback congelado `tpSize = slSize * 2`.

¿Apruebas y procedo a implementar?
