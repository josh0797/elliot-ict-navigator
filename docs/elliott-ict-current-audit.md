# Auditoría — Motor Elliott + ICT actual

Fecha: 2026-06-19. Repo: este proyecto Lovable (TanStack Start + TS + Lovable Cloud). No hay backend Python/FastAPI; toda la lógica vive en `src/lib/detection/*` y se consume desde server functions de TanStack y server routes en `src/routes/api/public/hooks/*`.

## Resumen por funcionalidad

| Funcionalidad | Estado | Ubicación | Notas |
|---|---|---|---|
| Modelo de vela (`Candle`) | Parcial | `src/lib/twelvedata.functions.ts` (`type Candle`) | No valida high/low coherentes, ni timestamps duplicados/no monótonos, ni precios <= 0. Sin `index` explícito. |
| ATR | Ausente | — | El motor no calcula ATR; `zigzag.ts` usa umbral porcentual fijo (0.3 %) sin normalizar por volatilidad. |
| Detección de pivotes | Heurística | `src/lib/detection/zigzag.ts` | ZigZag por % de retroceso, no fractales L/R. Sin umbral ATR, sin clasificación MINOR/MAJOR. Empuja el último pivote en formación como confirmado → **repaint implícito** (no marca `provisional`). |
| Alternancia H/L | Parcial | `zigzag.ts` | Implícita por el algoritmo; no se valida explícitamente ni se deduplican consecutivos del mismo tipo en otras rutas. |
| Confirmación / no-repaint | Ausente | — | No existe distinción `confirmed` vs `provisional`. |
| Etiquetado Elliott 1-5 | Heurística | `src/lib/detection/elliott.ts` `countElliott()` | Solo toma los últimos 6 pivotes alternados como 0..5. No genera candidatos múltiples, no soporta ciclos incompletos, no devuelve alternativos. |
| Regla 1 (W2 no supera origen W1) | Implementada | `elliott.ts:29` | Compara magnitud `W2 >= W1` — correcto solo porque W2 se mide desde W1; no compara precio absoluto contra `wave0.price`. Funciona pero la formulación no es canónica. |
| Regla 2 (W3 nunca la más corta) | Implementada | `elliott.ts:31` | OK: `W3 < W1 && W3 < W5`. |
| Regla 3 (W4 no solapa W1) | Implementada | `elliott.ts:33-36` | OK para impulso estándar. **No soporta excepciones de diagonal**. |
| Regla 4 (alternancia W2/W4) | Ausente | — | No se evalúa. |
| Regla 5 (proporcionalidad Fib) | Ausente | — | No se evalúa. |
| Truncamiento de onda 5 | Ausente | — | No se identifica. |
| Diagonal inicial / final | Ausente | — | No se soporta solapamiento permitido. |
| Estados del conteo | Ausente | — | Solo hay `valid: boolean`. Falta `NO_COUNT`/`DEVELOPING`/`VALID`/`INVALIDATED`/`COMPLETED`. |
| Correctivo A-B-C | Ausente | — | El conteo termina en wave 5; no hay detección de A/B/C ni tipos `ZIGZAG`/`FLAT`. |
| FVG | Implementada | `src/lib/detection/ict.ts` `detectFVG` | Correcto 3-velas (gap entre vela `i-2` y `i`). Recorta a 30 últimos. |
| Order Blocks | Heurística | `ict.ts` `detectOrderBlocks` | Usa relación `move/range >= 1.5` con 3 velas posteriores como impulso. No exige BOS posterior, no distingue mitigación. |
| Liquidity sweeps | Parcial | `ict.ts` `detectSweeps` | Mira solo últimas 20 velas y 5 pivotes recientes. No agrupa equal highs/lows. |
| BOS / CHoCH | Heurística | `ict.ts` `detectStructure` | Compara con el pivote anterior del mismo tipo, sin trackear bias estructural previo → confunde CHoCH con simple LH/HL. |
| Premium / Discount | Ausente | — | No se calcula rango de premium/discount sobre el último swing. |
| Killzones | Ausente | — | No se filtra por sesiones (London/NY). |
| Fibonacci | Parcial | `engine.ts:57` | Solo usa extensión 1.618 para TP1; no calcula niveles de retroceso para scoring Elliott. |
| Confluencias | Heurística | `engine.ts:67-74` | Suma estática 0.4 base + 0.05–0.2 por feature presente. Sin pesos calibrados. |
| Entry / SL | Heurística | `engine.ts:50-51` | Entry = borde de OB/FVG; SL = lado opuesto del bloque * (1 ± 0.1 %). No usa ATR. |
| TP1 / TP2 | Heurística | `engine.ts:53-65` | TP1 por extensión 1.618 desde W4. TP2 por liquidez opuesta dentro del set Elliott (no del libro de liquidez ICT real). |
| Score combinado heurística+ML | Implementada | `src/routes/api/public/hooks/scan-and-alert.ts` (via `scoreSetupML`) | OK: 0.5·heurística + 0.5·prob ML. |
| Render en gráfico | Parcial | `src/routes/_authenticated/chart.$symbol.tsx` | Dibuja velas y setup (entry/SL/TP) pero **no renderiza** pivotes, etiquetas Elliott, FVG, OB, BOS/CHoCH ni sweeps. |
| Exposición al modelo ML | Implementada | `src/lib/training.functions.ts` `rawToFeatureRaw` | Features actuales: instrument/timeframe/direction/pattern/wave_degree/wave_current + rr_ratio, sl_pips, dist_fib, has_alternative. |
| Duplicaciones | Sí | `engine.ts` y `chart.tsx` recortan `zigzag` con `depth=0.0025` en distintos sitios — el frontend re-detecta pivotes localmente. |
| Inconsistencias TS ↔ Python | N/A | — | No hay capa Python en este proyecto. |

## Cómo se etiquetan hoy las ondas (paso a paso)

1. `zigzag(candles, 0.0025)` produce lista de pivotes alternados por % de retroceso.
2. `countElliott()` toma los **últimos 9** y, si alternan H/L, considera los últimos 6 como `P0..P5`.
3. Aplica reglas 1, 2 y 3 (formulación de magnitudes).
4. Si pasa, devuelve `labels = ["1","2","3","4","5"]` mapeados a `P1..P5`. P0 no se etiqueta.
5. `currentWave` siempre se fija en `"5"` cuando hay 6 pivotes — no detecta que estemos en wave 2 o 4 vigente.

## Gaps prioritarios

1. **No-repaint**: el último pivote se trata como confirmado.
2. **Sin ATR**: imposible calibrar pivotes / SL por volatilidad.
3. **Conteo único sin alternativos**: pérdida de información para el modelo ML.
4. **Sin A-B-C** ni diagonales.
5. **BOS/CHoCH sin bias estructural** → falsos CHoCH.
6. **Sin premium/discount** ni killzones.
7. **El chart no muestra** ondas/zonas ICT.