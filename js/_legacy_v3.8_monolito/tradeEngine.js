/* ============================================================
   TRADE ENGINE — motor único de cálculo financiero de KAME
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

const TradeEngine = (() => {
  /**
   * Convierte un trade en su RR real (con signo).
   * TP  -> +rr (o 0 si no se registró)
   * SL  -> -|rr| (usa el RR real del formulario; si viene vacío,
   *        cae a -1 solo por compatibilidad con trades antiguos)
   * BE / otro -> 0
   */
  function resolveRR(trade) {
    if (!trade) return 0;
    if (trade.res === "TP") return parseFloat(trade.rr || 0);
    if (trade.res === "SL") return -Math.abs(parseFloat(trade.rr || 1));
    return 0;
  }

  /** Riesgo en USD dado un capital y un porcentaje de riesgo. */
  function riskUSD(capital, riesgoPct) {
    const cap = parseFloat(capital) || 0;
    const pct = parseFloat(riesgoPct) || 0;
    return cap * (pct / 100);
  }

  /** PnL en USD de un trade individual, dado el riesgo en USD vigente. */
  function pnlUSD(trade, riskUsdValue) {
    return resolveRR(trade) * (parseFloat(riskUsdValue) || 0);
  }

  /** Suma de RR neto de una lista de trades. */
  function netRR(trades) {
    return (trades || []).reduce((a, t) => a + resolveRR(t), 0);
  }

  /** Suma de PnL en USD de una lista de trades, a riesgo fijo. */
  function netUSD(trades, riskUsdValue) {
    return netRR(trades) * (parseFloat(riskUsdValue) || 0);
  }

  /** RR perdido/ganado en un día concreto (fecha 'YYYY-MM-DD'). */
  function dayNetRR(trades, fecha) {
    return netRR((trades || []).filter((t) => t.fecha === fecha));
  }

  /** Pérdida en USD de un día concreto (solo la parte negativa, en positivo). */
  function dayLossUSD(trades, riskUsdValue, fecha) {
    const rr = dayNetRR(trades, fecha);
    const usd = rr * (parseFloat(riskUsdValue) || 0);
    return Math.max(0, -usd);
  }

  /**
   * Igual que dayLossUSD, pero a partir de una equitySeries ya calculada
   * (cada trade puede tener un riskUSD distinto — soporta riesgo dinámico).
   */
  function dayLossUSDFromSeries(series, fecha) {
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
  function equitySeries(trades, capitalInicial, riskResolver) {
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
  function fixedRiskResolver(capitalInicial, riesgoPct) {
    const rUsd = riskUSD(capitalInicial, riesgoPct);
    return () => rUsd;
  }

  /** Riesgo dinámico: recalcula el riskUSD según el capital en ese momento. */
  function dynamicRiskResolver(riesgoPct) {
    return (_trade, capitalActual) => riskUSD(capitalActual, riesgoPct);
  }

  /** Drawdown máximo y actual (en USD y %) de una serie de equity. */
  function drawdown(series) {
    let peak = series.length ? series[0].balanceAntes : 0;
    let maxDD = 0,
      maxDDPct = 0;
    series.forEach((p) => {
      if (p.balanceDespues > peak) peak = p.balanceDespues;
      const dd = peak - p.balanceDespues;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      if (ddPct > maxDDPct) maxDDPct = ddPct;
    });
    const last = series[series.length - 1];
    const current = last ? Math.max(0, peak - last.balanceDespues) : 0;
    const currentPct = peak > 0 ? (current / peak) * 100 : 0;
    return { maxDD, maxDDPct, currentDD: current, currentDDPct: currentPct, peak };
  }

  /** Estadísticas agregadas de una lista de trades. */
  function stats(trades) {
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
  function interpretResult(rr) {
    const v = parseFloat(rr);
    if (isNaN(v)) return null;
    if (v > 0) return "TP";
    if (v < 0) return "SL";
    return "BE";
  }

  return {
    resolveRR,
    riskUSD,
    pnlUSD,
    netRR,
    netUSD,
    dayNetRR,
    dayLossUSD,
    dayLossUSDFromSeries,
    equitySeries,
    fixedRiskResolver,
    dynamicRiskResolver,
    drawdown,
    stats,
    interpretResult,
  };
})();
