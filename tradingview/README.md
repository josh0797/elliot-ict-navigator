# TradingView — Elliott Debugger v1

Indicador **independiente** (Pine Script v6) para depurar y validar el motor Elliott
sobre las velas nativas de TradingView. Es el **primer paso** de la nueva arquitectura:
esta versión es **Elliott-only**. No incluye ICT, no incluye SONIC y no ejecuta nada en MT5.

Archivo: [`Elliott_Debugger_v1.pine`](./Elliott_Debugger_v1.pine)

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
