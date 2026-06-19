# Plan — Elliott API v2 + ICT canónico + Render multicolor

Trabajo 100% dentro del stack actual: TanStack Start, React, TS, server functions, Lovable Cloud, Vitest, logreg JS. Sin Python/FastAPI/Render/scikit/Next.

Sobre `MASSIVE_API_KEY`: lo guardo vía `add_secret` (server-only) solo si lo vamos a usar en una server function. Pregunto al final si toca cablearlo a un proveedor de velas concreto; mientras tanto el contrato Elliott no depende de esa API.

---

## Bloque A — Elliott: contrato API + confianza 0–100

### A1. Tipos nuevos (no romper engine v2 actual)

`src/lib/detection/elliott/types.ts` añade:

```ts
export type ElliottStatus = "VALID" | "DEVELOPING" | "INVALIDATED" | "NO_COUNT" | "COMPLETED";
export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type RuleStatus = "PASS" | "FAIL" | "PENDING";

export interface ElliottRuleResult {
  code: "W2_ORIGIN" | "W3_NOT_SHORTEST" | "W4_OVERLAP" | "W2_RETRACE" | "W3_EXTENSION" | "W4_ALTERNATION" | "W5_PROJECTION";
  status: RuleStatus;
  message: string;
}

export interface ElliottWaveDTO {
  label: WaveLabel;
  index: number;
  time: string;      // ISO-8601
  price: number;
  type: "HIGH" | "LOW";
  confirmed: boolean;
}

export interface ElliottResultDTO {
  status: ElliottStatus;
  bias: Bias;
  pattern: WavePattern;
  currentWave: WaveLabel | null;
  completion: number;        // 0..1
  confidence: number;        // 0..100
  invalidationLevel: number | null;
  rules: ElliottRuleResult[];
  waves: ElliottWaveDTO[];
  alternatives: ElliottResultDTO[];
}
```

### A2. Scoring 0–100 (`elliott/scoring.ts`)

Función `computeConfidence(count, ctx)` con buckets:

| Componente | Máx |
|---|---|
| Reglas obligatorias (W2_ORIGIN, W3_NOT_SHORTEST, W4_OVERLAP) | 25 |
| Alternancia W2/W4 | 20 |
| Proporciones Fibonacci (W2, W3, W4, W5) | 20 |
| Claridad de pivotes (ATR distance + confirmed) | 15 |
| Duración temporal proporcional | 10 |
| Market structure alineada (bias HH/HL vs dirección) | 10 |

**Regla dura**: cualquier `FAIL` en obligatorias → `status: "INVALIDATED"`, `confidence: 0`. El candidato se descarta antes de scoring blando.

`completion` = nº de ondas confirmadas / 5 (impulso) o /3 (correctivo).

`invalidationLevel`:
- Si `currentWave ∈ {1,2,3}` → P0.
- Si `currentWave = 4` → P1 (overlap).
- Si `5` → última extrema del impulso.

### A3. Mapper engine v2 → DTO

`src/lib/detection/elliott/dto.ts` con `toElliottResult(analysis, candles): ElliottResultDTO`. Las reglas obligatorias se reportan siempre (PASS/FAIL/PENDING).

### A4. Server function

`src/lib/elliott.functions.ts`:

```ts
export const analyzeSymbol = createServerFn({ method: "POST" })
  .inputValidator(z.object({ symbol: z.string(), interval: z.string() }).parse)
  .handler(async ({ data }) => {
    const candles = await fetchCandles({ data });
    const pivots = detectPivots(...);
    const analysis = analyzeElliott(pivots);
    return toElliottResult(analysis, candles);
  });
```

### A5. Tests Vitest

`src/lib/detection/__tests__/elliott-dto.test.ts`:
- Impulso válido → status VALID/COMPLETED, todas obligatorias PASS, confidence > 60.
- W2 > W1 → INVALIDATED, confidence 0, regla W2_ORIGIN FAIL.
- W4 overlap → INVALIDATED salvo diagonal.
- DEVELOPING con onda 5 incompleta → W3_NOT_SHORTEST PENDING.

---

## Bloque B — ICT engine canónico

Nuevo árbol `src/lib/detection/ict/`:

```
ict/
  types.ts          FVG, OrderBlock, LiquidityLevel, Sweep, BOS, CHoCH, Killzone, PDArray, IctContext
  fvg.ts            3-candle imbalance, mitigación, fresh/tested
  orderBlocks.ts    last opposite candle antes de desplazamiento; bullish/bearish
  liquidity.ts      equal highs/lows, swing highs/lows, trendline liquidity
  sweeps.ts         barrido + cierre dentro del rango
  structure.ts      BOS / CHoCH desde market-structure (HH/HL/LH/LL)
  killzones.ts      London/NY/Asia por timestamp UTC
  pdArray.ts        Premium (>0.62) / Equilibrium (0.38–0.62) / Discount (<0.38) sobre rango dealing
  engine.ts         analyzeIct(candles, atr, pivots, swings, marketStructure) → IctContext
  __tests__/        unit tests por módulo
```

`IctContext` agregado:

```ts
interface IctContext {
  bias: Bias;
  fvgs: FVG[]; orderBlocks: OrderBlock[]; liquidity: LiquidityLevel[]; sweeps: Sweep[];
  structure: (BOS|CHoCH)[]; killzone: Killzone | null; pdArray: PDArray; score: number;
}
```

Engine v2 puro, sin tocar `src/lib/detection/ict.ts` legacy (queda `@deprecated`).

---

## Bloque C — Render multicolor en chart

Refactor de `src/routes/_authenticated/chart.$symbol.tsx` (no existe `TradingChart.tsx` aparte; lo creamos extrayendo).

### C1. Extraer `src/components/chart/TradingChart.tsx`

Props: `candles`, `elliott: ElliottResultDTO | null`, `ict: IctContext | null`, `layers: LayerToggles`.

### C2. Segmentos por color

Una `LineSeries` por tramo con su propio color:

| Segmento | Color |
|---|---|
| 0→1 | `#06b6d4` cyan |
| 1→2 | `#a855f7` purple |
| 2→3 | `#22c55e` green |
| 3→4 | `#f97316` orange |
| 4→5 | `#ec4899` magenta |
| 5→A | `#ef4444` red |
| A→B | `#eab308` gold |
| B→C | `#fb7185` coral |

Implementación: array `segments = pairwise(labeledPivots)` → `chart.addSeries(LineSeries, { color })` con dos puntos. Limpieza en cleanup ref.

### C3. Etiquetas

Por pivote: círculo + label (`createSeriesMarkers`), posición `aboveBar` si HIGH, `belowBar` si LOW. Estilo distinto para `confirmed=false` (opacity 0.5, sufijo `?`).

Tooltip con precio, fecha, estado: capa DOM overlay sincronizada con `subscribeCrosshairMove` (los markers nativos no soportan tooltip rich).

### C4. Línea de invalidación

`series.createPriceLine({ price: invalidationLevel, lineStyle: LineStyle.Dashed, color: "#ef4444", title: "INV: W4_OVERLAP" })` + tooltip vía leyenda lateral describiendo la regla.

### C5. Controles de capa

Panel lateral con `Switch` shadcn:
- Elliott lines
- Elliott labels
- Alternative count (renderiza `alternatives[0]` con opacity 0.4)
- Invalidation
- Fibonacci Elliott (overlay con retrocesos 0.382/0.5/0.618 sobre W1, y extensiones 1.0/1.618 sobre W3)

Estado local `useState<LayerToggles>` persistido en `localStorage`.

---

## Archivos a crear / editar

**Crear**
- `src/lib/detection/elliott/dto.ts`
- `src/lib/elliott.functions.ts`
- `src/lib/detection/__tests__/elliott-dto.test.ts`
- `src/lib/detection/ict/{types,fvg,orderBlocks,liquidity,sweeps,structure,killzones,pdArray,engine}.ts`
- `src/lib/detection/ict/__tests__/{fvg,orderBlocks,liquidity,structure}.test.ts`
- `src/components/chart/TradingChart.tsx`
- `src/components/chart/LayerControls.tsx`
- `src/components/chart/InvalidationLegend.tsx`

**Editar**
- `src/lib/detection/elliott/{types,scoring,engine}.ts` — añadir buckets + DTO mapping
- `src/routes/_authenticated/chart.$symbol.tsx` — usar `TradingChart` + layers + nuevo DTO

**No tocar** legacy `src/lib/detection/{elliott,ict,zigzag,engine}.ts` (siguen `@deprecated` hasta migrar setup builder).

---

## Fuera de alcance (siguientes fases)

- Confluencia Elliott × ICT y nuevo Setup Builder (Fase 4).
- Exponer features ICT al `logreg` (Fase 6).
- Sustituir `fetchCandles` (TwelveData) por la nueva `MASSIVE_API_KEY` — **necesito confirmación**: ¿qué proveedor es y qué endpoint OHLCV expone? Si confirmas, lo añado como `src/lib/massive.functions.ts` + `add_secret MASSIVE_API_KEY` server-only en un commit aparte.

¿Procedo con Bloques A + B + C tal cual?
