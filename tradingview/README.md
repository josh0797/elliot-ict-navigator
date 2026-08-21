# TradingView — Elliott × ICT × SONIC

| Script | Versión | Alcance |
|---|---|---|
| [`Elliott_ICT_SONIC_v2.pine`](./Elliott_ICT_SONIC_v2.pine) | **v2.0.0** (actual) | Elliott + ICT nativo + panel SONIC-likeness |
| [`Elliott_Debugger_v1.pine`](./Elliott_Debugger_v1.pine) | v1.0.1 (referencia estable) | Elliott-only |

> **Primera prueba obligatoria en TradingView Pine Editor.** Pega el script en el Pine
> Editor y compílalo (**Save** / **Add to chart**). Si el editor devuelve **cualquier**
> error de compilación, envíanos **captura de pantalla + número de línea** para corregirlo
> inmediatamente.

**MT5 / ejecución de órdenes: PENDIENTE — siguiente iteración.** La v2 no implementa
`strategy()`, ni órdenes, ni broker bridge, ni automatización.

---

## v2 — Instalación

1. Pine Editor → **Open** → **New indicator**.
2. Borra el contenido y pega **todo** `Elliott_ICT_SONIC_v2.pine`.
3. **Save** (p. ej. `Elliott x ICT x SONIC v2`) → **Add to chart**.
4. Si tenías la v1 en el chart, **quítala** (el panel Elliott es el mismo y se solaparían
   las tablas). La v1 se conserva en el repo como referencia y puede seguir usándose sola.

### Defaults recomendados — primera prueba XAUUSD 4H

| Grupo | Input | Valor |
|---|---|---|
| Elliott | Elliott ON | ✔ |
| Elliott | leftBars / rightBars | 4 / 4 |
| Elliott | minAtrDistance | 0.9 |
| Elliott | Minimum confidence | 60 |
| Elliott | Vista provisional / tail | OFF |
| Debug | Debug labels on active count | `Combined` |
| Debug | Show debug pivots | ON |
| Debug | Show raw pivots | OFF |
| ICT | Structure (BOS/CHoCH) | ON |
| ICT | Liquidity + sweeps | ON |
| ICT | FVG | OFF |
| ICT | Order Blocks | OFF |
| SONIC | Panel | ON |
| SONIC | Marcar 5/5 en chart | OFF |
| Visual | Label spacing | `Normal` |

---

## v2 — Corrección del overlap Elliott vs debug pivots

Antes, la etiqueta de onda (`A`, `B`, `C`, `3`…) y la etiqueta de pivot (`P35 H`) se
dibujaban en el **mismo punto** (bar_index + precio del pivot) y quedaban una encima de
la otra.

Ahora:

- Las **líneas** Elliott siguen ancladas al `bar_index` y al **precio real** del pivot.
  No se ha movido ningún endpoint del algoritmo.
- Solo la **posición Y de la etiqueta** se desplaza, en múltiplos de ATR.
- Input **`Debug labels on active count`**:
  - `Combined` (default) → una sola etiqueta: `3 · P12 H`.
  - `Hide` → los pivots del conteo activo no muestran su `Pxx`.
  - `Separate` → dos etiquetas con offsets ATR distintos: Elliott **cerca** del swing,
    debug **más lejos**.
- Input **`Label spacing`**: `Compact` (0.35 ATR) · `Normal` (0.70) · `Wide` (1.20).
- El **conteo alternativo** usa una única etiqueta discreta (`alt …`) con offset mayor,
  de modo que nunca cae sobre las del primario.
- **ICT** usa símbolos pequeños (`BOS↑`, `CHoCH↓`, `×` para sweeps) anclados a
  `high`/`low` de la barra del evento, y boxes para FVG/OB: no compiten con las etiquetas
  de onda.

---

## v2 — Capa ICT (grupo `3 · ICT`, toggles independientes)

Portado conceptualmente de `src/lib/detection/ict.ts` y `src/lib/detection/ict/*`.
Todo se evalúa **solo en barras cerradas** (`barstate.isconfirmed`), sin lookahead.

| Toggle | Qué hace |
|---|---|
| **Structure** | BOS↑/↓ y CHoCH↑/↓ sobre el último high/low **estructural confirmado**: se requiere **cierre** más allá del nivel. Si el bias previo era contrario → CHoCH; si coincidía → BOS. |
| **Liquidity** | BSL sobre highs estructurales recientes y SSL sobre lows. Estado `ACTIVE` → `SWEPT` (mecha rompe y **cierre vuelve**) o `BROKEN` (cierre al otro lado = breakout, no barrido). Solo se dibujan los **N niveles activos** más recientes. |
| **FVG** | Bullish `low > high[2]`, bearish `high < low[2]`. Box desde la vela central; **mitigación** cuando el precio toca el midpoint (igual que `fvg.ts`). No repinta. |
| **Order Blocks** | Igual que `detectOrderBlocks`: última vela de color **opuesto** antes de un movimiento impulsivo; impulso mínimo configurable (default **1.5× el rango de la vela**) medido tras **3 velas** (configurable). **En Pine no hay futuro**: el OB se detecta cuando esas 3 velas **ya cerraron** y el box se dibuja hacia atrás sobre la vela origen → **retraso de confirmación = `OB velas de confirmación` barras**. El panel lo indica (`delay 3b`). |

Panel ICT: bias estructural (BULLISH/BEARISH/NEUTRAL), último BOS, último CHoCH, FVG
activas, OB activos, último sweep + contador.

Por defecto solo están encendidos **Structure** y **Liquidity**; FVG y OB están OFF para
mantener el chart limpio.

---

## v2 — SONIC-likeness · `PRE_RAID_APPROACH_V1`

Portado de `src/lib/ml/smc/pre-raid.ts`. **Semántica obligatoria:**

- Es un detector **determinista y congelado**, no un modelo entrenado.
- `setupScore = componentes que pasan / 5`. Es **likeness de setup**, *no* probabilidad
  de ganar. El panel lo dice explícitamente: **`likeness ≠ win probability`**.
- **No** participa en el gating Elliott/ICT, **no** altera la confidence Elliott, **no**
  genera BUY/SELL ni órdenes, y no emite alertas.
- Ventana validada: **Europe/London, lunes–viernes, 06:00–07:59 local**. Fuera de ella el
  panel muestra `FUERA DE VENTANA` y no hay señal.

Features congeladas (mediana TRAIN · signo), `pass = (valor − mediana) × signo > 0`:

| Feature | Mediana | Signo |
|---|---|---|
| `dist_relevant_local_liq_atr` | 1.911168 | −1 |
| `micro_hhhl_score_5` | 0.0 | −1 |
| `minutes_since_relevant_raid_norm` | 1.0 | −1 |
| `position_in_asia_range_dir` | 0.393471 | +1 |
| `approach_velocity_liq_3m_atr` | 0.021757 | +1 |

Cálculo (idéntico en semántica al TS): ATR **M5 Wilder(14)** construido desde buckets M1
cerrados; liquidez local relevante en la ventana **[cand−60m, cand−10m)** (LONG usa el
mínimo, SHORT el máximo); distancia normalizada por ATR M5; micro HH/HL sobre las
**últimas 5 M1** (4 comparaciones, invertido por dirección); raid lookback **30 M1** con
`minutes_since_relevant_raid_norm` capado a 1; rango asiático **00:00–06:00 Europe/London**
(LONG `1 − rawPos`, SHORT `rawPos`); velocidad de aproximación sobre **3 minutos** contra
el mismo nivel relevante.

### M1 nativo vs proxy

El detector se calcula en contexto **M1** vía
`request.security(syminfo.tickerid, "1", …, lookahead=barmerge.lookahead_off)`.

- Chart en 1m → panel muestra **`M1 native`** (paridad de referencia).
- Chart en timeframe superior → **`M1 proxy / last closed M1`**: los valores corresponden
  al último M1 **cerrado** dentro de la barra en curso. Es correcto y no repinta, pero **no
  es un barrido minuto a minuto** del bloque.

### Limitaciones frente al servidor (inevitables)

- Pine **no puede** consultar Supabase ni el histórico de **SONIC Audit**: no hay HTTP ni
  base de datos. El detector se recalcula localmente con datos de TradingView; no se
  duplica ni se sincroniza la DB.
- El servidor evalúa **cada minuto candidato** de la ventana y persiste la observación;
  la v2 evalúa el **minuto actual** del chart.
- Los `skip reasons` del servidor (`M1_GAP_AT_CANDIDATE`, `ASIA_RANGE_UNAVAILABLE`, …) se
  resumen en el panel como `—` / `Asia range insuficiente`.
- El feed M1 de TradingView puede diferir del proveedor de la app web (Twelve Data /
  Polygon), por lo que los valores no serán bit-idénticos.

---

## v1 — referencia estable (Elliott-only)

Archivo: [`Elliott_Debugger_v1.pine`](./Elliott_Debugger_v1.pine)


### Cambios en v1.0.1

- El filtro ATR usa el ATR de la **barra real del swing** (`atrV[rightBars]`), no el de la barra de confirmación.
- Al sustituir un pivot por otro más extremo del mismo tipo se **recalcula `sDist`** (claridad).
- **Outside bars**: si high y low se confirman en la misma barra, se conserva **un solo** pivot
  estructural — el compatible con la alternancia respecto del último pivot; si no hay pivot previo,
  se conserva el **HIGH** (criterio explícito). Nunca hay dos endpoints en el mismo `bar_index`.
- **Recencia**: los candidatos deben terminar en uno de los **últimos 3 pivots** (`End lag <= 2`).
  El panel muestra `End lag`.
- Estado **`INVALID`** en el panel cuando el candidato reciente más completo rompe una regla dura
  y no hay geometría válida reciente. `NO_COUNT` cuando hay geometría válida pero por debajo de
  *Minimum confidence*. Nunca se fuerza un conteo.

---


## 1. Instalación (pasos exactos)

1. Abre TradingView y carga el chart del activo (p. ej. `XAUUSD`).
2. Abajo, pestaña **Pine Editor** → menú **Open** → **New indicator**.
3. Borra el contenido de ejemplo.
4. Copia **todo** el contenido de `Elliott_Debugger_v1.pine` y pégalo.
5. Pulsa **Save** y dale un nombre (p. ej. `Elliott Debugger v1`).
6. Pulsa **Add to chart**.
7. Icono de ajustes del indicador (⚙) → pestaña **Inputs** para configurar.

---

## 2. Configuración recomendada inicial (XAUUSD)

Punto de partida para validar, **no** una configuración universal: cada activo y
cada régimen de volatilidad puede requerir ajuste.

| Input | 1H | 4H | 1D |
|---|---|---|---|
| Degree | `Minor` o `Auto` | `Intermediate` | `Major` |
| leftBars | 3 | 4 | 5 |
| rightBars | 3 | 4 | 5 |
| ATR length | 14 | 14 | 14 |
| minAtrDistance | 0.75 | 0.9 | 1.0 |
| Minimum confidence | 60 | 60 | 62 |
| Show debug pivots | ON | ON | ON |
| Show raw pivots | OFF (ON para depurar filtro) | OFF | OFF |
| Vista provisional / tail | OFF | OFF | OFF |

Con `Degree = Auto` el indicador elige por temporalidad: `1D+ → Major`,
`4H–1D → Intermediate`, intradía `<4H → Minor`. El selector manual siempre manda.

---

## 3. `rightBars` y confirmación de pivots (sin lookahead)

`ta.pivothigh(high, leftBars, rightBars)` / `ta.pivotlow(...)` **no** pueden confirmar
un swing hasta que existan `rightBars` barras posteriores. Es decir:

- El swing ocurrió en la barra `bar_index - rightBars`.
- El indicador solo lo conoce `rightBars` barras después.
- La etiqueta se dibuja en la **barra histórica exacta** del swing, pero nunca antes
  de estar confirmada. No hay lookahead ni `request.security(..., lookahead_on)`.

Consecuencia práctica: con `rightBars = 3` en 1H, un pivot aparece ~3 horas después
de formarse. Subir `rightBars` = menos ruido y más retardo. Bajarlo = antes y más ruido.

La opción **Vista provisional / tail** proyecta el tramo en curso desde el último pivot
hasta el precio actual. Está desactivada por defecto, se dibuja **punteada** y con
sufijo `?` porque **puede repintar**. Las ondas confirmadas nunca repintan.

---

## 4. Qué implementa

- **Pivots**: fractal `leftBars/rightBars`, alternancia HIGH/LOW estricta (dos pivots
  consecutivos del mismo tipo → se conserva el más extremo), filtro de distancia en
  múltiplos de ATR para eliminar micro-ruido. Si el ATR aún no ha calentado, el pivot
  se acepta pero no se infla la distancia.
- **Degree** como sensibilidad del detector: `Major` ensancha el fractal y multiplica
  el umbral ATR ×2.5 (menos pivots); `Minor` lo estrecha y lo multiplica ×0.5 (más
  pivots); `Intermediate` usa los inputs tal cual.
- **Reglas duras**: R1 (W2 no cruza el origen de W1), R2 (W3 no es la más corta cuando
  existe W5), R3 (W3 supera el extremo de W1), R4 (solapamiento W1/W4 → se clasifica
  como `DIAGONAL`, no se invalida en silencio). W5 truncada solo como
  *possible / unconfirmed*, nunca confirmada por una sola condición.
- **ABC** simple (S-A-B-C) que **compite por score** con impulso/diagonal. En v1 no hay
  W-X-Y: se prefiere `NO_COUNT` a inventar estructura.
- **Score 0–100**: reglas (45) + proximidad Fibonacci W2/W3/W4/W5 (25) + cobertura del
  conteo (20) + claridad de pivots en ATR (10). Por debajo de `Minimum confidence`
  → `NO_COUNT` y **no** se dibuja conteo primario.
- **Etiquetas por grado**: `MAJOR [1]` · `INTERMEDIATE 1` · `MINOR i`.
- **Panel diagnóstico**: estado, pattern, dirección, degree, confidence, pivots
  raw/estructurales/usados, onda actual, invalidación, `rightBars` y motivo.

---

## 5. Checklist de validación visual

1. **Anclaje exacto**: cada label `0/1/2/3/4/5` (o `S/A/B/C`) cae **sobre el máximo o
   mínimo real** de la vela del swing, no en una vela vecina. Activa
   *Show debug pivots* y comprueba que los labels del conteo coinciden con los `P#`.
2. **Sin etiqueta por vela**: las líneas atraviesan velas intermedias sin etiquetarlas.
   Eso es correcto: Elliott cuenta swings.
3. **Reglas**: W2 no cruza el origen de W1; W3 supera W1 y no es la más corta;
   W4 no entra en territorio de W1 salvo que el panel muestre `DIAGONAL`.
4. **NO_COUNT**: sube `Minimum confidence` a 85–90 en un rango lateral → el panel debe
   pasar a `NO_COUNT` y el conteo primario debe desaparecer.
5. **Confirmación**: con *Vista provisional* OFF, el último pivot nunca debe estar en las
   últimas `rightBars` velas.
6. **Filtro ATR**: activa *Show raw pivots* y sube `minAtrDistance` → deben quedar
   menos pivots estructurales que raw.
7. **Límites**: con `Máx. debug pivots` alto en charts muy largos, si TradingView avisa
   de límite de objetos, redúcelo.

---

## 6. Roadmap

1. **v1 (esto)** — Elliott-only: pivots, degrees, reglas, score, NO_COUNT, panel debug.
2. **v2** — Capa ICT (liquidez, FVG, order blocks, BOS/CHoCH).
3. **v3** — SONIC / pre-raid como filtro diagnóstico.
4. **v4** — Puente de señales y finalmente EA de MT5.

---

## 7. Limitaciones reales

- Pine no tiene compilador local: la **compilación final debe verificarse en el Pine
  Editor** de TradingView. La sintaxis se revisó manualmente (tipos de arrays, `na`,
  IDs de `line`/`label`, tuplas, scope, mutación de globales, loops, `table`).
- El conteo se calcula y dibuja solo en la última barra: no hay histórico de conteos
  pasados en el chart (por diseño, para respetar los límites de objetos de Pine).
- Los candidatos se buscan sobre los **últimos 8 pivots estructurales**; conteos de
  grado superior a ese alcance requieren cambiar `Degree` o la temporalidad.
- Las etiquetas de debug se limitan a las últimas N para no exceder
  `max_labels_count = 500`.
- No se modifica ninguna lógica de la app (Elliott/ICT/SONIC): esta carpeta es aditiva.
