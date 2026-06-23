# Plan: Setup canónico v2 con hard gates y política robusta

Refactor del motor de setups para sustituir el scoring acumulativo blando por **hard gates** explícitos, una política de entry/SL/TP bien definida y un tipo canónico independiente del legacy.

## 1. Nuevo tipo canónico independiente (`types.ts`)

Reemplazar `TradeSignal` por `TradeSetupV2` versionado, sin herencia del contrato legacy:

```ts
interface TradeSetupV2 {
  schemaVersion: "canonical-setup-v2";
  id: string; symbol: string; timeframe: string;
  direction: "long" | "short";
  orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP"
           | "MARKET_BUY" | "MARKET_SELL" | "NO_ORDER";
  status: "READY" | "WAITING_RETRACE" | "TRIGGERED" | "INVALIDATED" | "NO_SETUP";
  entry: number; sl: number; tp1: number; tp2: number;
  rrToTp1: number; rrToTp2: number;
  priceAtDetection: number;
  // metadatos de SL/TP/POI para auditoría
  sl Basis: { elliottInvalidation: number|null; poiExtreme: number;
              sweepExtreme: number|null; protectedSwing: number|null;
              atrBuffer: number; chosen: "max"|"min" };
  tp1Source: { liquidityId: string; price: number } | { fallback: "2R" };
  tp2Source: { wave: string; from: number; to: number; projectedFrom: number; ratio: 1.618 }
           | { fallback: "3R" };
  poi: { kind: "ORDER_BLOCK"|"FVG"; id: string; proximal: number; distal: number; state: string };
  score: number;                    // canonical
  mlScore: number|null;             // ACTIVE BASELINE diagnostic
  modelVersion: string|null;
  breakdown: ScoreBreakdown;
  confluences: SignalConfluence[];
  gatesPassed: string[];            // auditoría de hard gates
  rationale: string;
  detectedAt: number;
}
```

`LegacyInput` se construye solo vía adapter explícito desde `TradeSetupV2`.

## 2. Hard gates obligatorios (`engine.ts`)

Antes de cualquier scoring, una candidata debe pasar TODAS estas verificaciones; si falla cualquiera → descartada (no se baja el score, se elimina):

1. `elliott.primary` existe y `state !== "INVALIDATED"`.
2. POI alineado con la dirección y `state ∈ {FRESH, TOUCHED}` (no `MITIGATED`/`INVALIDATED`).
3. `entry`, `sl`, `tp1`, `tp2` son finitos y > 0.
4. SL en el lado correcto: long → `sl < entry`; short → `sl > entry`.
5. TP1 en el lado correcto: long → `tp1 > entry`; short → `tp1 < entry`.
6. `risk = |entry - sl| > 0`.
7. `rrToTp1 >= minRR` (default 1.0).
8. POI no invalidado por precio posterior (close más allá del distal).
9. Pivotes usados en estructura/POI deben ser `confirmed: true`.
10. **Confirmación estructural**: al menos una de:
    - BOS/CHoCH `CONFIRMED` en la misma dirección dentro de N velas, o
    - sweep válido (`wickBeyond && closeBack`) + `displacementAfter` + POI activo en la zona del sweep.

Solo entonces se computa el score; el umbral `MIN_SCORE` se mantiene como filtro adicional, no como sustituto de los gates.

## 3. Política de Entry

- `proximal = top` (long) / `bottom` (short) del POI.
- `distal = bottom` (long) / `top` (short).
- Si `priceAtDetection` ya está dentro del POI → `orderType = MARKET_*`, `status = TRIGGERED`.
- Si fuera (precio aún no alcanzó el POI) → `BUY_LIMIT`/`SELL_LIMIT` en proximal, `status = WAITING_RETRACE`.
- Si el POI ya quedó atrás (precio cruzó el distal) → `status = INVALIDATED`, descartar.
- Para OB+FVG superpuestos: usar la intersección como zona de entrada.

## 4. Política de Stop Loss

`sl` debe quedar más allá de **todos** los niveles estructurales relevantes + buffer ATR:

- Long: `sl = min(elliottInvalidation, poiDistal, sweepLow, protectedSwingLow) - atr * 0.1`.
- Short: `sl = max(elliottInvalidation, poiDistal, sweepHigh, protectedSwingHigh) + atr * 0.1`.

Los componentes ausentes se omiten del min/max. `slBasis` registra cada valor para auditoría.

## 5. Política de TP1

Liquidez elegible debe cumplir TODAS:

- `state === "ACTIVE"` (no `SWEPT`/`BROKEN`).
- `!provisional`.
- Lado correcto: long → BSL con `price > entry`; short → SSL con `price < entry`.
- No mitigada/barrida previamente.
- Genera `rr >= minRR`.

Selección: la más cercana al entry que cumpla todo. Si ninguna cualifica → fallback `entry ± 2R`, marcado en `tp1Source`.

## 6. Política de TP2

Extensión 1.618 explícita:

- Onda usada: si Elliott está en onda 2 → proyectar onda 3 desde fin de onda 1.
- Si en onda 4 → proyectar onda 5 desde fin de onda 3.
- Si en B → proyectar C desde fin de A.
- `from`, `to`, `projectedFrom` registrados en `tp2Source`.
- Si la onda base está incompleta o faltan pivotes → fallback `entry ± 3R` con `tp2Source.fallback`.

## 7. Tests nuevos (`engine.test.ts`)

Añadir casos golden para cada gate (cada uno debe descartar el setup):

- Elliott `INVALIDATED` → 0 setups.
- POI `MITIGATED` → 0 setups.
- SL del lado equivocado (datos forzados) → descartado.
- RR insuficiente → descartado.
- Sin BOS confirmado ni sweep+displacement → descartado aunque score sea alto.
- Precio dentro del POI → `orderType = MARKET_*`, `status = TRIGGERED`.
- Precio antes del POI → `BUY_LIMIT`, `status = WAITING_RETRACE`.
- Liquidez provisional ignorada para TP1; usa fallback 2R.
- TP2 fallback cuando faltan pivotes Elliott.

Tests legacy adapter ajustados al nuevo `TradeSetupV2`.

## 8. SignalsPanel

Mostrar `orderType`, `status`, `slBasis` resumido, fuente de TP1/TP2. Sin cambios estructurales mayores.

## Archivos a modificar

- `src/lib/detection/setup/types.ts` — `TradeSetupV2` canónico.
- `src/lib/detection/setup/engine.ts` — hard gates + políticas entry/SL/TP.
- `src/lib/detection/setup/legacyAdapter.ts` — adapter desde `TradeSetupV2`.
- `src/lib/detection/setup/__tests__/engine.test.ts` — nuevos golden tests.
- `src/lib/detection/setup/__tests__/legacyAdapter.test.ts` — ajustar.
- `src/components/chart/SignalsPanel.tsx` — render de orderType/status.
- `src/lib/setups.functions.ts` — tipo retorno.
- `.lovable/plan.md` — documentar contrato v2.

Sin cambios en motores ICT/Elliott existentes (ya entregan los datos necesarios).
