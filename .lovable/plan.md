
# Plan — Adapter `legacy-pretrained-html-v1` (congelado, en paralelo)

Objetivo: integrar el modelo MLP pre-entrenado del HTML legacy como un scorer
independiente y verificable, sin tocar el pipeline canónico ni el `logreg` actual.
No se reentrena nada en esta iteración.

## 1. Artefacto de pesos

Crear `src/lib/ml/legacy/pretrained.json` con el bloque exacto extraído de
`elliott-ict-pro2.html` línea 3125 (`PRETRAINED`):
- `weights`: 6 arrays planos en orden `[W0, b0, W1, b1, W2, b2]`
  shapes `(6×12)=72, 12, (12×8)=96, 8, (8×1)=8, 1`.
- `minNorm` (6), `maxNorm` (6).
- Metadata: `trainedAt`, `samples=698`, `accuracy_test=0.5286`,
  `win_rate_dataset=0.4971`, `schema="legacy-pretrained-html-v1"`,
  `status="TRAINING_SCHEMA_VERIFIED"`,
  array `warnings` con las 9 advertencias documentadas (fvg proxy, atr no Wilder,
  is_killzone constante, score heurístico, dist_ob no usa OB real, waveCode ordinal
  artificial, target post-hoc contaminado, accuracy 52.86%, baseline 49.71%).

## 2. Extractor legacy (proxies exactos)

Crear `src/lib/ml/legacy/features.ts` con `extractLegacyFeatures(input)` que
devuelve `{ raw: number[6], normalized: number[6], waveLabelUsed, warnings }`.

Input (DTO mínimo; sin asumir nombres del pipeline canónico):
```ts
type LegacyInput = {
  confirmationLevel: number;
  invalidationLevel: number;
  fibTarget1?: number | null;
  rrRatio?: number | null;
  hasAlternative?: boolean;
  currentPriceApprox?: number | null;
  waveLabel?: string | null;   // "1","(iii)","B",...
};
```

Fórmulas (textualmente las del mensaje del usuario):
- `slSize = |confirmation - invalidation|`
- `tpSize = fibTarget1 finito ? |confirmation - fibTarget1| : slSize*2`
- `f0 = min(tpSize/slSize, 5)/5`
- `f1 = min(slSize/confirmation, 0.05)/0.05`
- `f2 = 0.5` (constante por contrato)
- `rrNorm = min(max(rr,0),5)/5`; `f3 = rrNorm*0.7 + (1-hasAlt)*0.3`
- `f4 = currentPrice>0 ? min(|current-conf|/slSize,3)/3 : 0.5`
- `f5 = waveCodeMap(label)` con tabla legacy literal:
  `1/(1)/i/(i)→0.1, 2/(2)/ii/(ii)→0.2, 3/(3)/iii/(iii)→0.9,
   4/(4)/iv/(iv)→0.4, 5/(5)/v/(v)→0.6, A→0.3, B→0.1, C→0.7, else 0.5`.
  Match exacto tras `trim().toLowerCase()`; etiqueta desconocida añade
  warning `UNKNOWN_WAVE_LABEL` y devuelve 0.5.
- Normalización min-max: si `max>min`, `(x-min)/(max-min)`; si no, `0.5`.
  Sin clipping adicional. (`f2` siempre cae al else → 0.5, consistente con
  `minNorm[2]=maxNorm[2]=0.5`.)

## 3. Forward pass

Crear `src/lib/ml/legacy/mlp.ts` con `predictLegacy(xNorm: number[6]): number`:
- Carga pesos vía `import pretrained from "./pretrained.json"`.
- Reconstruye matrices a partir de los flats con shapes fijas.
- `h1 = relu(x · W0 + b0)`  (12)
- `h2 = relu(h1 · W1 + b1)` (8)   (dropout desactivado en inferencia)
- `y  = sigmoid(h2 · W2 + b2)` (1)
- Devuelve `y ∈ [0,1]`.

Helpers `relu`, `sigmoid` locales (estables: `sigmoid` con rama por signo).

## 4. Scorer público

Crear `src/lib/ml/legacy/index.ts`:
```ts
export const LEGACY_SCHEMA = "legacy-pretrained-html-v1";
export function scoreLegacy(input: LegacyInput): {
  schema: string; probability: number;
  features: { raw: number[]; normalized: number[] };
  warnings: string[]; metadata: { ... };
};
```
Este scorer **no** se enchufa a `loadActiveModel()` ni a `scoreSetupML()`.
Queda disponible para shadow logging / UI / comparación futura. Cero cambios
en `src/lib/detection/model.ts`, `training.functions.ts`, `logreg.ts` o en
rutas/loaders existentes. Sin cambios operativos.

## 5. Golden tests

Crear `src/lib/ml/legacy/__tests__/legacy.test.ts` con los 11 tests pedidos:

1. **Fórmulas exactas** — 6 casos parametrizados, uno por feature, comprobando
   `raw[i]` con tolerancia 1e-12.
2. **Orden del vector** — keys del array == `[fvgSizeProxy, atrNormProxy,
   isKillzone, scoreProxy, distObProxy, waveCode]` (vía constante exportada
   `LEGACY_FEATURE_ORDER`).
3. **Longitud 6** — `raw.length === 6 && normalized.length === 6`.
4. **Fallback TP=2R** — sin `fibTarget1`: con slSize=10 → tpSize=20 →
   `f0 = min(2,5)/5 = 0.4`.
5. **Fallback distOB=0.5** — sin `currentPriceApprox` → `f4 = 0.5`.
6. **isKillzone constante** — siempre `0.5` independientemente del input.
7. **Mapping waveCode** — tabla completa, incluyendo paréntesis y romanos
   en mayúsculas/minúsculas, más `"Z" → 0.5 + warning UNKNOWN_WAVE_LABEL`.
8. **Min-max exacto** — vector raw conocido vs normalización manual con los
   `minNorm`/`maxNorm` del JSON.
9. **Rango cero → 0.5** — para índice 2 (`min==max`), normalized[2] siempre
   `0.5` incluso si raw cambia.
10. **Forward pass manual vs predicción conocida del HTML** — capturar la
    predicción del HTML para un input fijo y compararla. Procedimiento en
    construcción: ejecutaré el bloque `MLEngine.predict` del HTML con un
    input conocido (`slSize=10, fibTarget1` produce `tpSize=20`,
    `confirmation=100`, `rr=2`, `hasAlt=false`, `currentPrice=100`,
    `wave="3"` → vector raw `[0.4, 0.5/100/0.05 capped, 0.5, …]`) usando
    Node con los pesos del JSON, anotaré el valor esperado en el test y
    validaré igualdad ≤ 1e-9 contra `predictLegacy(normalized)`.
11. **Shapes de pesos** — assert que tras reconstruir, las matrices tienen
    `[6,12], [12], [12,8], [8], [8,1], [1]`.

## 6. Separación con `canonical-ict-v2`

- Carpeta dedicada `src/lib/ml/legacy/*`. Nada en esta carpeta se importa
  desde `model.ts`, `training.functions.ts`, ni desde rutas operativas.
- Documentar en `src/lib/ml/legacy/README.md` (corto): schema congelado,
  no reentrenar, no fusionar con `logreg`, advertencias, accuracy 52.86%.

## Detalles técnicos

- TypeScript estricto: tipos `number[]` para los flats, tuplas `[number,...]`
  donde aplica, sin `any`.
- JSON importado con `with { type: "json" }` o `import data from "./pretrained.json"`
  según convención existente del repo (verificar `tsconfig.json` permite
  `resolveJsonModule`; el repo ya usa imports JSON).
- Tests con vitest (mismo runner que `ict/__tests__/*.test.ts`).
- Sin dependencias nuevas. Sin tocar `package.json`.

## Archivos a crear

- `src/lib/ml/legacy/pretrained.json`
- `src/lib/ml/legacy/features.ts`
- `src/lib/ml/legacy/mlp.ts`
- `src/lib/ml/legacy/index.ts`
- `src/lib/ml/legacy/README.md`
- `src/lib/ml/legacy/__tests__/legacy.test.ts`

## Archivos NO modificados

- `src/lib/detection/model.ts`
- `src/lib/training.functions.ts`
- `src/lib/ml/logreg.ts`
- Rutas / loaders / UI operativa
