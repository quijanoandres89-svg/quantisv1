/* ============================================================
   TRADE ENGINE (módulo ES) — motor único de cálculo financiero de KAME
   ------------------------------------------------------------
   Ningún otro archivo debe reimplementar estas fórmulas.
   Todo cálculo de PnL, riesgo, RR, balance, equity, drawdown
   y estadísticas pasa por aquí.

   Compatibilidad: hoy los trades siguen guardando res:"TP"/"SL"/"BE"
   + un campo rr (magnitud). resolveRR() es el único lugar que
   interpreta esa combinación. El día que el registro pase a
   "solo RR" (Entrega 3), basta con adaptar resolveRR() y todo
   lo demás sigue funcionando igual, sin tocar nada más.
   ============================================================ */

// Versión ES module: mismas funciones, mismo comportamiento, solo
// cambia "const TradeEngine = (()=>{...})()" por exports directos.


/**
 * Convierte un trade en su RR real (con signo).
 * TP  -> +rr (o 0 si no se registró)
 * SL  -> -|rr| (usa el RR real del formulario; si viene vacío,
 *        cae a -1 solo por compatibilidad con trades antiguos)
 * BE / otro -> 0
 */
export function resolveRR(trade) {
  if (!trade) return 0;
  if (trade.res === "TP") return parseFloat(trade.rr || 0);
  if (trade.res === "SL") return -Math.abs(parseFloat(trade.rr || 1));
  return 0;
}

/** Riesgo en USD dado un capital y un porcentaje de riesgo. */
export function riskUSD(capital, riesgoPct) {
  const cap = parseFloat(capital) || 0;
  const pct = parseFloat(riesgoPct) || 0;
  return cap * (pct / 100);
}

/** PnL en USD de un trade individual, dado el riesgo en USD vigente. */
export function pnlUSD(trade, riskUsdValue) {
  return resolveRR(trade) * (parseFloat(riskUsdValue) || 0);
}

/** Suma de RR neto de una lista de trades. */
export function netRR(trades) {
  return (trades || []).reduce((a, t) => a + resolveRR(t), 0);
}

/** Suma de PnL en USD de una lista de trades, a riesgo fijo. */
export function netUSD(trades, riskUsdValue) {
  return netRR(trades) * (parseFloat(riskUsdValue) || 0);
}

/** RR perdido/ganado en un día concreto (fecha 'YYYY-MM-DD'). */
export function dayNetRR(trades, fecha) {
  return netRR((trades || []).filter((t) => t.fecha === fecha));
}

/** Pérdida en USD de un día concreto (solo la parte negativa, en positivo). */
export function dayLossUSD(trades, riskUsdValue, fecha) {
  const rr = dayNetRR(trades, fecha);
  const usd = rr * (parseFloat(riskUsdValue) || 0);
  return Math.max(0, -usd);
}

/**
 * Igual que dayLossUSD, pero a partir de una equitySeries ya calculada
 * (cada trade puede tener un riskUSD distinto — soporta riesgo dinámico).
 */
export function dayLossUSDFromSeries(series, fecha) {
  const usd = (series || [])
    .filter((p) => p.trade && p.trade.fecha === fecha)
    .reduce((a, p) => a + p.pnlUSD, 0);
  return Math.max(0, -usd);
}

/**
 * Serie de balance/equity trade a trade.
 * riskResolver(trade, capitalActual) debe devolver el riskUSD a aplicar
 * en ese trade — permite riesgo fijo (siempre el mismo valor) o
 * dinámico (recalculado según capitalActual) sin cambiar esta función.
 */
export function equitySeries(trades, capitalInicial, riskResolver) {
  let capital = parseFloat(capitalInicial) || 0;
  const series = [];
  (trades || []).forEach((t) => {
    const rUsd = riskResolver(t, capital);
    const pnl = pnlUSD(t, rUsd);
    const before = capital;
    capital += pnl;
    series.push({
      trade: t,
      riskUSD: rUsd,
      pnlUSD: pnl,
      balanceAntes: before,
      balanceDespues: capital,
    });
  });
  return series;
}

/** Riesgo fijo: mismo riskUSD en todos los trades (basado en capital inicial). */
export function fixedRiskResolver(capitalInicial, riesgoPct) {
  const rUsd = riskUSD(capitalInicial, riesgoPct);
  return () => rUsd;
}

/** Riesgo dinámico: recalcula el riskUSD según el capital en ese momento. */
export function dynamicRiskResolver(riesgoPct) {
  return (_trade, capitalActual) => riskUSD(capitalActual, riesgoPct);
}

/**
 * Drawdown "corrida completa": el mismo cálculo que drawdownFromValues,
 * pero devuelve el drawdown en CADA punto de la serie (no solo el
 * máximo final) — lo que necesita una curva de drawdown en el tiempo.
 */
export function runningDrawdownFromValues(initialValue, values) {
  const list = values || [];
  let peak = list.length ? initialValue : 0;
  return list.map((v) => {
    if (v > peak) peak = v;
    const dd = peak - v;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    return { dd, ddPct, peak };
  });
}

/**
 * Drawdown máximo y actual (en valor y %) a partir de una serie
 * numérica simple (balance, equity, o RR acumulado — lo que sea).
 * Es el cálculo base; drawdown() y cualquier otro consumidor lo
 * reutilizan en vez de reimplementar la fórmula.
 */
export function drawdownFromValues(initialValue, values) {
  const list = values || [];
  const running = runningDrawdownFromValues(initialValue, list);
  const maxDD = running.length ? Math.max(...running.map((r) => r.dd)) : 0;
  const maxDDPct = running.length
    ? Math.max(...running.map((r) => r.ddPct))
    : 0;
  const last = running[running.length - 1];
  return {
    maxDD,
    maxDDPct,
    currentDD: last ? last.dd : 0,
    currentDDPct: last ? last.ddPct : 0,
    peak: last ? last.peak : list.length ? initialValue : 0,
  };
}

/** Drawdown máximo y actual (en USD y %) de una serie de equity. */
export function drawdown(series) {
  const list = series || [];
  const initial = list.length ? list[0].balanceAntes : 0;
  const values = list.map((p) => p.balanceDespues);
  return drawdownFromValues(initial, values);
}

/**
 * Recovery Factor = ganancia neta / peor drawdown sufrido.
 * Ambos valores deben estar en la misma unidad (USD con USD, R con R).
 */
export function recoveryFactor(netValue, maxDD) {
  if (maxDD > 0) return netValue / maxDD;
  return netValue > 0 ? Infinity : 0;
}

/** Histograma de trades agrupados por rango de RR obtenido. */
export function rDistribution(trades) {
  const values = (trades || []).map(resolveRR);
  const buckets = [
    { label: "< -2R", test: (v) => v < -2 },
    { label: "-2R a -1R", test: (v) => v >= -2 && v < -1 },
    { label: "-1R a 0R", test: (v) => v < 0 && v >= -1 },
    { label: "0R (BE)", test: (v) => v === 0 },
    { label: "0R a 1R", test: (v) => v > 0 && v <= 1 },
    { label: "1R a 2R", test: (v) => v > 1 && v <= 2 },
    { label: "2R a 3R", test: (v) => v > 2 && v <= 3 },
    { label: "> 3R", test: (v) => v > 3 },
  ];
  return buckets.map((b) => ({
    label: b.label,
    count: values.filter(b.test).length,
  }));
}

/** Histograma de trades agrupados por % de riesgo realmente usado (del snapshot). */
export function riskDistribution(trades) {
  const withSnap = (trades || []).filter(
    (t) => t.challengeSnapshot && t.challengeSnapshot.riesgoPorcentaje != null,
  );
  const groups = {};
  withSnap.forEach((t) => {
    const key = parseFloat(t.challengeSnapshot.riesgoPorcentaje).toFixed(2);
    groups[key] = (groups[key] || 0) + 1;
  });
  return Object.entries(groups)
    .map(([pct, count]) => ({ pct: parseFloat(pct), count }))
    .sort((a, b) => a.pct - b.pct);
}

/** Estadísticas agregadas de una lista de trades. */
export function stats(trades) {
  const list = trades || [];
  const decisivos = list.filter((t) => t.res === "TP" || t.res === "SL");
  const wins = list.filter((t) => t.res === "TP");
  const losses = list.filter((t) => t.res === "SL");
  const be = list.filter((t) => t.res === "BE");

  const rrWins = wins.map(resolveRR);
  const rrLosses = losses.map(resolveRR); // negativos

  const grossWin = rrWins.reduce((a, v) => a + v, 0);
  const grossLoss = Math.abs(rrLosses.reduce((a, v) => a + v, 0));

  const winrate = decisivos.length
    ? Math.round((wins.length / decisivos.length) * 100)
    : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const avgWin = rrWins.length ? grossWin / rrWins.length : 0;
  const avgLoss = rrLosses.length ? grossLoss / rrLosses.length : 0;
  const expectancy = decisivos.length
    ? netRR(decisivos) / decisivos.length
    : 0;
  const largestWin = rrWins.length ? Math.max(...rrWins) : 0;
  const largestLoss = rrLosses.length ? Math.min(...rrLosses) : 0;

  return {
    total: list.length,
    wins: wins.length,
    losses: losses.length,
    be: be.length,
    winrate,
    profitFactor,
    expectancy,
    avgRR: decisivos.length ? netRR(decisivos) / decisivos.length : 0,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    netRR: netRR(list),
  };
}

/** Interpreta un RR crudo según la futura convención "solo RR" (Entrega 3). */
export function interpretResult(rr) {
  const v = parseFloat(rr);
  if (isNaN(v)) return null;
  if (v > 0) return "TP";
  if (v < 0) return "SL";
  return "BE";
}

/**
 * Eficiencia de captura (Fase 3 — Entrega 11, Opción C: proxy de
 * MAE/MFE sin depender de un proveedor de precios externo).
 * % del movimiento planeado (entrada → TP) que realmente se capturó
 * (entrada → salida real), respetando la dirección del trade.
 * Devuelve null si falta algún precio o si el TP planeado == entrada
 * (no se puede dividir por un movimiento planeado de cero).
 */
export function captureEfficiency(trade) {
  if (!trade) return null;
  const entry = parseFloat(trade.precioEntrada);
  const tp = parseFloat(trade.precioTP);
  const exit = parseFloat(trade.precioSalida);
  if (isNaN(entry) || isNaN(tp) || isNaN(exit)) return null;
  const isLong = trade.dir === "Compra";
  const planned = isLong ? tp - entry : entry - tp;
  const captured = isLong ? exit - entry : entry - exit;
  if (planned === 0) return null;
  return (captured / planned) * 100;
}

/**
 * Win rate agrupado por un campo del trade (Fase 4, bloque 4C —
 * Entrega 23). Genérica: sirve para sesión, tipo de setup, par, o
 * cualquier otro campo categórico — un solo lugar para este cálculo
 * en vez de repetir el mismo patrón filter+reduce en cada módulo que
 * lo necesite.
 */
export function winRateByField(trades, field) {
  const groups = {};
  (trades || []).forEach((t) => {
    const key = t[field];
    if (!key) return;
    if (!groups[key]) groups[key] = { wins: 0, total: 0 };
    groups[key].total++;
    if (t.res === "TP") groups[key].wins++;
  });
  return Object.entries(groups).map(([key, g]) => ({
    key,
    count: g.total,
    wr: g.total ? Math.round((g.wins / g.total) * 100) : 0,
  }));
}
