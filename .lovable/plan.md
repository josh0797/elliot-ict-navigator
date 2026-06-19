## Elliott + ICT Pro — App de trading con alertas en tiempo real

App web que escanea los 7 pares mayores de FX + XAU/USD usando Twelve Data, detecta confluencias entre **conteo Elliott** (5 impulsivas + ABC) e **ICT** (Order Blocks, FVG, Liquidity Sweeps, BOS/CHoCH), y emite alertas con **Entry / SL / TP** dentro de la app y por **Telegram**.

Arquitectura **híbrida**: detección y trazos corren en el navegador (rápido, sin costos), Lovable Cloud persiste setups + resultados + modelo compartido entre dispositivos, y un cron server-side evalúa TP/SL y dispara las alertas de Telegram.

### Stack
- **Frontend**: TanStack Start + React, gráficos con `lightweight-charts` (TradingView), TF.js para reentrenar el modelo de scoring en el browser.
- **Datos**: Twelve Data (API key proporcionada). Polling cada 60s para timeframes operativos.
- **Backend**: Lovable Cloud (Supabase) para tablas, RLS, cron y server functions. Conector **Telegram** vía gateway de Lovable.
- **Pares/TFs por defecto**: EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, XAUUSD en 15m, 1h, 4h (configurable por usuario).

### Pantallas
1. **Dashboard** — grid de los 8 activos con estado actual (tendencia, onda en curso, último setup, alertas activas).
2. **Chart detail** — gráfico con trazos automáticos: pivotes ZigZag, etiquetas de ondas 1-2-3-4-5/A-B-C, cajas OB, FVG sombreado, líneas de liquidez barridas, marcadores BOS/CHoCH y zonas de entrada con E/SL/TP.
3. **Alertas** — feed en tiempo real (toast + panel persistente) con historial y resultado (TP1/SL/Pendiente).
4. **Backtest & Modelo** — métricas del modelo TF.js, winrate por par/TF, botón "reentrenar con datos actuales".
5. **Settings** — pares/TFs activos, riesgo %, chat_id de Telegram, umbral mínimo de score.

### Motor de detección (cliente)
```text
OHLCV → ZigZag pivotes → Elliott counter (valida reglas:
  W2 ≤ 100% W1, W3 no la más corta, W4 no solapa W1)
                       ↓
         ICT layer: BOS/CHoCH, OB bullish/bearish,
         FVG, sweeps de highs/lows previos
                       ↓
   Confluencia: entrada en OB/FVG dentro de W2 o W4
                       ↓
   Setup = { entry, sl (bajo OB / sobre sweep),
             tp1 = 1.618 ext, tp2 = liquidez próxima,
             score = modelo TF.js }
```

### Backend (Lovable Cloud)
- Tablas: `setups`, `alerts`, `trade_results`, `model_versions` (blob), `user_settings` (con `telegram_chat_id`), `user_roles`.
- RLS por `auth.uid()` en todas las tablas de usuario; `service_role` para el cron.
- **Server function `scan-and-alert`** (cron cada 1-5 min): consulta Twelve Data, corre detección headless, inserta `setups` nuevos y envía Telegram vía connector gateway.
- **Server function `evaluate-results`** (cron cada 15 min): por cada setup abierto compara precio actual vs SL/TP, marca resultado, alimenta `trade_results` para entrenar el modelo.
- Realtime de Supabase → el frontend recibe inserts en `alerts` instantáneamente (toast + sonido).

### Modelo (híbrido A+B)
- TF.js entrena en el browser sobre `trade_results` traídos de Cloud (no se borra al limpiar storage).
- Modelo se serializa y guarda en `model_versions` como blob; al cargar la app se baja el más reciente.
- Features: tipo de onda, fuerza del OB, tamaño del FVG, RSI/ATR, distancia a liquidez, sesión (Londres/NY), par.

### Alertas
- **In-app**: Sonner toast + panel lateral con badge.
- **Telegram**: connector de Lovable. El usuario inicia chat con el bot → guarda su `chat_id` en settings → cada alerta envía mensaje formateado (par, TF, dirección, Entry, SL, TP1, TP2, score, link al chart).

### Seguridad
- `TWELVEDATA_API_KEY` como secret server-side (no expuesto al cliente; el cron lo usa, y para el preview en vivo el frontend lo consulta vía un server function proxy con rate limit).
- RLS estricto, roles en tabla separada `user_roles`, función `has_role` SECURITY DEFINER.

### Entregables por fase
1. **Fase 1** — Cloud + esquema + auth + dashboard con datos en vivo y trazos Elliott/ICT en chart detail.
2. **Fase 2** — Motor de confluencia + cálculo de E/SL/TP + persistencia de setups + alertas in-app realtime.
3. **Fase 3** — Cron server-side + integración Telegram + evaluación de resultados.
4. **Fase 4** — Modelo TF.js con persistencia en Cloud + panel de métricas y reentrenamiento.

### Lo que necesitarás darme después
- Confirmar enable de **Lovable Cloud** (yo lo activo).
- Guardar `TWELVEDATA_API_KEY` como secret (yo lo solicito).
- Conectar el connector **Telegram** (yo lo inicio).
- Tu `chat_id` de Telegram (lo capturas en Settings tras hablarle al bot).
