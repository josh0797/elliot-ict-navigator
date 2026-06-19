# Contrato objetivo — Motor Elliott + ICT canónico

Contrato de tipos que la nueva pipeline (`src/lib/detection/{indicators,structure,elliott,ict,confluence,schemas}`) debe respetar. Los tipos legacy en `src/lib/detection/types.ts` se mantienen como **superset compatible**: solo se añaden campos opcionales nuevos para no romper consumidores (`engine.ts`, server functions, UI).

## Vela

```ts
export interface Candle {
  index: number;       // posición en el array fuente
  time: number;        // unix seconds, ascendente sin duplicados
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
```

`validateCandles(candles)` devuelve `{ valid: boolean, warnings: string[] }`:
- `high >= max(open, close, low)`
- `low  <= min(open, close, high)`
- timestamps estrictamente ascendentes, sin duplicados
- precios finitos y > 0

## Pivote

```ts
export type PivotKind = "HIGH" | "LOW";
export type PivotStrength = "MINOR" | "MAJOR";

export interface Pivot {
  id: string;              // `${time}-${kind}`
  index: number;
  time: number;            // ISO no — usamos unix seconds en cliente
  price: number;
  type: PivotKind;
  strength: PivotStrength;
  atrDistance: number;     // |Δprice| / ATR(prev pivot)
  confirmed: boolean;      // false hasta que existan `rightBars` a la derecha
}
```

Reglas:
- Detección por fractales con `leftBars` / `rightBars` configurables (defaults 3/3).
- Umbral mínimo `minAtrDistance` (default 0.75 × ATR14).
- Alternancia forzada: si dos pivotes consecutivos comparten `type`, se conserva el más extremo.
- Elliott consume preferentemente `strength === "MAJOR"`.
- El último pivote puede ser `confirmed: false` (provisional) cuando faltan barras a la derecha.

## Swing

```ts
export interface Swing {
  from: Pivot;
  to: Pivot;
  direction: "up" | "down";
  magnitudeAtr: number;
  bars: number;
}
```

## Elliott

```ts
export type WaveLabel = "0" | "1" | "2" | "3" | "4" | "5" | "A" | "B" | "C";

export type WavePattern =
  | "IMPULSE"
  | "LEADING_DIAGONAL"
  | "ENDING_DIAGONAL"
  | "ZIGZAG"
  | "FLAT"
  | "SIMPLE_CORRECTION"
  | "UNKNOWN_CORRECTION";

export type CountState =
  | "NO_COUNT"
  | "DEVELOPING"
  | "VALID"
  | "INVALIDATED"
  | "COMPLETED";

export interface LabeledPivot {
  pivot: Pivot;
  label: WaveLabel;
}

export interface ElliottCountV2 {
  direction: "long" | "short";
  pattern: WavePattern;
  state: CountState;
  labeled: LabeledPivot[];        // 2..9 pivotes etiquetados
  currentWave: WaveLabel | null;
  score: number;                  // 0..1
  fibScores: {
    wave2Retracement: number | null; // 0..1 cercanía a 0.382/0.5/0.618/0.786
    wave3Extension: number | null;   // 0..1 cercanía a 1.0/1.618/2.618
    wave4Retracement: number | null;
    wave5Projection: number | null;
  };
  alternation: number | null;     // 0..1 alternancia W2/W4
  invalidations: string[];        // razones si state = INVALIDATED
  notes: string[];
}

export interface ElliottAnalysis {
  primary: ElliottCountV2 | null;
  alternatives: ElliottCountV2[];
}
```

## ICT (Fase ≥3 — referencia)

Se mantiene `ICTContext` actual y se le añadirán de forma opcional:

```ts
interface ICTContextV2 extends ICTContext {
  premiumDiscount?: { rangeHigh: number; rangeLow: number; equilibrium: number };
  killzone?: "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | null;
  liquidityPools?: { type: "BSL" | "SSL"; price: number; equalCount: number; time: number }[];
}
```

## Setup (extensión compatible)

`TradeSetup` permanece tal cual; se añaden campos **opcionales**:

```ts
interface TradeSetupV2 extends TradeSetup {
  elliottV2?: ElliottAnalysis;
  pivotsV2?: Pivot[];
  swings?: Swing[];
  scoreBreakdown?: { elliott: number; ict: number; confluence: number };
}
```

## Features expuestas al modelo ML (extensión)

Manteniendo el orden actual de `rawToFeatureRaw`, se podrán añadir tras los actuales:

- `elliott_v2_score` (numérico)
- `wave2_fib_score`, `wave3_fib_score`, `wave4_fib_score`, `wave5_fib_score`
- `has_alternative_count_v2`
- `pivot_confirmed` (0/1)

La adición debe ser estrictamente al final del vector para preservar la compatibilidad de modelos ya entrenados (cuyos pesos son `Float64Array` indexados posicionalmente).