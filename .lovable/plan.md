## Goal

Permitirte subir tu CSV histórico (`elliott_dataset.csv` y futuros), entrenar un modelo de probabilidad de éxito por setup, guardarlo versionado en `model_versions`, y que el scanner use ese modelo para mejorar el score de las alertas.

## Dataset analizado

3.309 filas. Etiquetas útiles `win` (608) y `loss` (906) → ~1.514 muestras de entrenamiento. El resto (`pending`, `no_symbol_or_data`) se descarta.

Columnas que usaremos como features:
- Categóricas: `instrument` (normalizado a `EUR/USD` etc.), `timeframe` (normalizado a minúsculas), `direction`, `pattern`, `wave_degree`, `wave_current` (bucketizado: motriz 1/3/5, correctivo 2/4, ABC, WXY, subondas).
- Numéricas derivadas: `rr_ratio`, `sl_pips`, distancia Fib (presencia de `fib_618`, `fib_382`, `fib_786`), `has_alternative`.
- Target: `result == 'win'` → 1, `result == 'loss'` → 0.

## UX (página nueva)

Nueva ruta protegida **`/training`** (solo rol `admin`) con:
1. Tarjeta de **Upload CSV**: drag & drop, valida cabeceras, muestra preview (rows, win/loss ratio).
2. Botón **Entrenar modelo** → llama server function, muestra progreso, devuelve accuracy de validación y nº de features.
3. Lista de **versiones** desde `model_versions` (versión, accuracy, trained_on, fecha) con botón "Activar" para marcar la versión usada en el scanner.
4. Panel **Importancia de features** (top 15 coeficientes) tras entrenar.

Acceso al menú lateral: enlace "Training" visible solo si `has_role(uid,'admin')`. Para tu cuenta, el primer admin se asigna desde una migración seed (`INSERT user_roles ... 'admin'` con tu `user_id`).

## Backend

### Tabla
Reusamos `model_versions` (ya existe). Añadimos columna `is_active boolean default false` y un índice único parcial para tener una sola versión activa. Añadimos `feature_names text[]` y `metrics jsonb` (accuracy, precision, recall, sample sizes, confusion matrix).

### Server functions (`src/lib/training.functions.ts`, admin-gated con `requireSupabaseAuth` + check `has_role`)
- `uploadDataset({ csv: string })` → parsea, valida, devuelve resumen (counts, columnas faltantes).
- `trainModel({ csv: string })` →
  1. Parse CSV (sin libs nativas, parser puro JS).
  2. Normaliza y construye matriz X/y.
  3. Split 80/20 estratificado.
  4. Entrena **regresión logística** con gradiente descendente + L2 (implementación pura JS — el Worker runtime no soporta sklearn ni binarios nativos, ver `server-runtime`).
  5. Calcula accuracy/precision/recall en validación.
  6. Inserta nueva fila en `model_versions` con `version = max+1`, `weights_b64` (Float64Array → base64), `model_topology` (jsonb con feature spec y normalizers), `metrics`, marca `is_active = true` y desactiva las anteriores.
- `setActiveModel({ version })` → admin.
- `listModelVersions()` → admin.

### Scoring
Helper `scoreSetup(features)` en `src/lib/detection/model.ts` que, al ejecutar el scanner (`/api/public/hooks/scan-and-alert`), carga la versión activa del modelo (cache en memoria por invocación), calcula la probabilidad y la combina con el score heurístico actual (ej. `score = 0.5*heuristic + 0.5*model_prob`). Sigue funcionando si no hay modelo activo (fallback al heurístico).

## Seguridad

- Toda la ruta `/training` y todas las server functions exigen rol `admin` (RLS de `model_versions` ya restringido a admin, lo extendemos a INSERT/UPDATE/DELETE).
- CSV se procesa en memoria, no se almacena el dataset crudo.
- Límite de tamaño: 5 MB por upload.

## Detalles técnicos

```text
training.functions.ts
  ├─ parseCsv(text) -> rows[]
  ├─ buildFeatures(rows) -> { X: number[][], y: number[], spec }
  ├─ trainLogisticRegression(X, y, {lr, epochs, l2}) -> { w, b }
  ├─ evaluate(model, Xval, yval) -> metrics
  └─ persistModel(spec, weights, metrics)  // supabaseAdmin (cargado dentro del handler)

detection/model.ts
  ├─ loadActiveModel()  // cache por proceso
  └─ scoreSetup(setupFeatures) -> number  // 0..1
```

Persistencia de pesos: `Float64Array` → `Buffer.from(...).toString('base64')` en `weights_b64`. Topology guarda `{ featureNames, categoricalEncodings, numericMeans, numericStds, intercept }`.

## Cambios de archivos

- nuevo `src/routes/_authenticated/training.tsx` (+ enlace en sidebar condicional)
- nuevo `src/lib/training.functions.ts`
- nuevo `src/lib/csv.ts` (parser)
- nuevo `src/lib/ml/logreg.ts`
- nuevo `src/lib/detection/model.ts` + integración en `src/routes/api/public/hooks/scan-and-alert.ts`
- migración SQL: añade `is_active`, `feature_names`, `metrics` a `model_versions`; políticas RLS INSERT/UPDATE para admin; seed opcional de admin (te preguntaré tu email/uid en build mode si quieres asignarlo automáticamente).

## Fuera de alcance (siguiente iteración)

- Re-entrenamiento automático semanal con datos en vivo de `setups`+`trade_results` (ya cubierto por la arquitectura, lo dejamos para después de validar el flujo manual).
- Modelos no lineales (RandomForest/GBM) — requieren un servicio externo; el plan los descarta deliberadamente para no añadir Railway/Render.
