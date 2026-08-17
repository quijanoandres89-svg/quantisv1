/* ============================================================
   DASHBOARD — semáforo (getSem), página Principal, alertas,
   calendario de la semana, mini-lista de trades recientes y
   el gráfico de equity.
   ------------------------------------------------------------
   renderDash() llama a renderDashJournal(), que vive en
   journalManager.js (Bloque 8) — dependencia hacia adelante,
   normal en este orden de construcción; se prueba de forma
   aislada aquí y de forma integrada cuando exista ese módulo.
   ============================================================ */

import {
  trades,
  challenges,
  eqC,
  setChart,
  gaugeRentC,
  gaugeCortoC,
  gaugeLargoC,
} from "./state.js";
import {
  today,
  fmtShort,
  fmtUSD,
  lastValuePillPlugin,
  tradeDurationMinutes,
  escapeHTML,
} from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { tradePnlUSD, usdExtremes } from "./tradeManager.js";
import { renderDashJournal } from "./journalManager.js";
import { renderChallengeAlerts } from "./alertSystem.js";
import { calcChProgress } from "./challengeManager.js";
import { buildGrid, tradeMapByDate, summarize } from "./calendarPro.js";

/** Semáforo de disciplina: puede/no puede operar según el historial reciente. */
export function getSem() {
  if (trades.length < 3)
    return {
      l: "g",
      title: "Puedes operar",
      sub: "Menos de 3 trades. Empieza a registrar.",
    };
  const l10 = trades.slice(-10);
  const wins = l10.filter((t) => t.res === "TP").length;
  const decisivos = l10.filter((t) => t.res === "TP" || t.res === "SL").length;
  const wr = decisivos ? wins / decisivos : 1;
  const soloDecisivos = trades.filter((t) => t.res === "TP" || t.res === "SL");
  const consec =
    soloDecisivos.slice(-3).length === 3 &&
    soloDecisivos.slice(-3).every((t) => t.res === "SL");
  const rrA = l10
    .filter((t) => t.res === "TP" && t.rr)
    .map((t) => parseFloat(t.rr));
  const rr = rrA.length ? rrA.reduce((a, b) => a + b, 0) / rrA.length : 0;
  if (consec || wr < 0.35)
    return {
      l: "r",
      title: "No puedes operar",
      sub: `3 pérdidas seguidas o WR <35%. Cierra la plataforma.`,
    };
  if (wr < 0.5 || rr < 1.5)
    return {
      l: "y",
      title: "Ten precaución",
      sub: `WR ${Math.round(wr * 100)}% o RR ${rr.toFixed(1)}. Solo setups A+.`,
    };
  return {
    l: "g",
    title: "Puedes operar",
    sub: `WR ${Math.round(wr * 100)}% · RR ${rr.toFixed(1)} · Racha estable.`,
  };
}

/** Refresca el badge de semáforo del sidebar. main.js la llama tras cambios de estado. */
export function renderSidebar() {
  const s = getSem();
  document.getElementById("sem-sb-wrap").innerHTML =
    `<div class="sem-sb s${s.l}" onclick="activarSesion()"><span class="sdot sd${s.l}"></span>${s.title}</div>`;
}

// [window] go('dash', ...) la dispara desde main.js
export function renderDash() {
  document.getElementById("dash-date").textContent =
    new Date().toLocaleDateString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const s = getSem();
  const cm = {
    g: ["var(--gbg)", "var(--gbr)", "var(--green)", "↑"],
    y: ["var(--ybg)", "var(--ybr)", "var(--yellow)", "-"],
    r: ["var(--rbg)", "var(--rbr)", "var(--red)", "↓"],
  };
  const c = cm[s.l];
  document.getElementById("dash-sem").innerHTML =
    `<div class="sem-card" style="background:${c[0]};border-color:${c[1]};color:${c[2]}"><div class="si" style="background:${c[1]}">${c[3]}</div><div><div class="st" style="color:${c[2]}">${s.title}</div><div class="ss" style="color:${c[2]}">${s.sub}</div></div></div>`;
  renderAlerts();
  renderChallengeAlerts("dash-rule-alerts");
  const tot = trades.length,
    wins = trades.filter((t) => t.res === "TP").length;
  const decisivos = trades.filter(
    (t) => t.res === "TP" || t.res === "SL",
  ).length;
  const wr = decisivos ? Math.round((wins / decisivos) * 100) : 0;
  const plan = tot
    ? Math.round((trades.filter((t) => t.plan === "Sí").length / tot) * 100)
    : 0;
  const rrA = trades
    .filter((t) => t.res === "TP" && t.rr)
    .map((t) => parseFloat(t.rr));
  const rr = rrA.length
    ? (rrA.reduce((a, b) => a + b, 0) / rrA.length).toFixed(1)
    : "-";
  document.getElementById("dash-metrics").innerHTML = `
    <div class="metric"><div class="mv">${tot}</div><div class="ml"><span class="material-symbols-outlined icons">
calculate
</span>Total trades</div></div>
    <div class="metric"><div class="mv" style="color:${wr >= 50 ? "var(--green)" : "var(--red)"}">${wr}%</div><div class="ml"><span class="material-symbols-outlined icons">
radar
</span>Win rate</div></div>
    <div class="metric"><div class="mv">${rr}</div><div class="ml"><span class="material-symbols-outlined icons">
model_training
</span>RR promedio</div></div>
    <div class="metric"><div class="mv" style="color:${plan >= 80 ? "var(--green)" : "var(--yellow)"}">${plan}%</div><div class="ml"><span class="material-symbols-outlined icons">
book_ribbon
</span>Plan respetado</div></div>`;
  renderDashKPIs();
  renderDashGauges();
  renderDashCalendar();
  renderRecentMini();
  renderEquityChart();
  renderDashJournal();
  renderDashChallenge();
  renderMiniRDist();
  renderDashPerformance();
  renderSidebar();
}

export function renderAlerts() {
  const a = [];
  const soloSL = trades.filter((t) => t.res === "TP" || t.res === "SL");
  if (soloSL.length >= 3 && soloSL.slice(-3).every((t) => t.res === "SL"))
    a.push(
      `<div class="alert ae"><span class="material-symbols-outlined icons">trending_down</span> 3 pérdidas consecutivas — semáforo ROJO. Cierra la plataforma.</div>`,
    );
  if (trades.filter((t) => t.fecha === today()).length >= 1)
    a.push(
      `<div class="alert ai"><span class="material-symbols-outlined icons">payment_arrow_down</span> Ya tienes un trade hoy (${trades.filter((t) => t.fecha === today())[0].res}). Según el plan: sesión terminada.</div>`,
    );
  if (trades.slice(-5).filter((t) => t.res === "TP").length >= 4)
    a.push(
      `<div class="alert aw"><span class="material-symbols-outlined icons">trending_up</span> Racha ganadora. Cuidado con la euforia — doble checklist en el próximo trade.</div>`,
    );
  document.getElementById("dash-alerts").innerHTML = a.join("");
}

/** "125 min" -> "2h 5min" para las tarjetas del Dashboard (mismo
 * formato que ya usa calcDuracion() en Historial, factorizado acá
 * porque esta función necesita el promedio ya redondeado a un
 * entero de minutos, no el string final). */
function fmtMinutes(mins) {
  const m = Math.round(mins);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

/**
 * Fila de KPIs "estilo terminal financiero" (Fase 4, bloque 4C —
 * Entrega 28), a pedido del usuario con una imagen de referencia de
 * otra app de trading journal. Reducida de 6 a 5 tarjetas respecto al
 * pedido original: "Operaciones" ya lo muestra dash-metrics ("Total
 * trades") más arriba, así que agregarlo acá hubiera sido un dato
 * duplicado en la misma pantalla. "Total de lotes usados" se
 * descartó por decisión del usuario (KAME no captura tamaño de
 * posición por trade).
 * Cero cálculos nuevos: Profit Factor ya lo calcula
 * TradeEngine.stats() (se usa igual en Estadísticas), mayor
 * ganancia/pérdida $ reutiliza tradePnlUSD() vía el helper nuevo
 * usdExtremes() de tradeManager.js, y la duración usa
 * tradeDurationMinutes() (extraído de calcDuracion() en esta misma
 * entrega para poder promediarlo).
 */
function renderDashKPIs() {
  const el = document.getElementById("dash-kpis");
  if (!el) return;

  const diasOperados = new Set(trades.map((t) => t.fecha)).size;
  const s = TradeEngine.stats(trades);
  const { maxWin, maxLoss } = usdExtremes(trades);

  const durs = trades
    .map((t) => tradeDurationMinutes(t.hora, t.horaCierre))
    .filter((v) => v !== null && v > 0);
  const avgDur = durs.length
    ? durs.reduce((a, v) => a + v, 0) / durs.length
    : null;

  el.innerHTML = `
    <div class="metric"><div class="mv">${diasOperados}</div><div class="ml"><span class="material-symbols-outlined icons">
calendar_month
</span>Días operados</div></div>
    <div class="metric"><div class="mv" style="color:${s.profitFactor >= 1.5 ? "var(--green)" : "var(--red)"}">${s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}</div><div class="ml"><span class="material-symbols-outlined icons">
balance
</span>Profit Factor</div></div>
    <div class="metric"><div class="mv">${avgDur !== null ? fmtMinutes(avgDur) : "—"}</div><div class="ml"><span class="material-symbols-outlined icons">
schedule
</span>Duración promedio</div></div>
    <div class="metric"><div class="mv" style="color:var(--green)">${maxWin !== null ? "+$" + maxWin.toFixed(2) : "—"}</div><div class="ml"><span class="material-symbols-outlined icons">
trending_up
</span>Mayor ganancia</div></div>
    <div class="metric"><div class="mv" style="color:var(--red)">${maxLoss !== null ? "-$" + Math.abs(maxLoss).toFixed(2) : "—"}</div><div class="ml"><span class="material-symbols-outlined icons">
trending_down
</span>Mayor pérdida</div></div>`;
}

/**
 * Componente Gauge reutilizable (Fase 4, bloque 4C — Entregas 29-30),
 * a pedido del usuario con imagen de referencia de otra app de
 * trading journal. Medio-círculo con Chart.js (doughnut con
 * circumference:180/rotation:-90) en vez de sumar una segunda
 * librería de gráficos — todo lo demás del proyecto ya usa Chart.js.
 * Recibe cualquier subconjunto de trades y es la MISMA función para
 * las 3 tarjetas (Rentabilidad = todos, Análisis corto = Venta,
 * Análisis largo = Compra) — nada de copiar/pegar el render 3 veces.
 * ------------------------------------------------------------
 * Cero cálculos nuevos: reutiliza tradePnlUSD() (tradeManager.js)
 * para todos los montos en USD; el "relleno" verde del arco es la
 * tasa de aciertos, mismo criterio TP/SL de TradeEngine.stats().
 * ------------------------------------------------------------
 * Decisión de diseño (avisada al usuario, no estaba 100% cerrada en
 * la planificación): el centro de las 3 tarjetas muestra el PnL neto
 * en USD del subconjunto — la imagen de referencia mostraba
 * "Total de operaciones" en el centro de "Rentabilidad" en vez de $,
 * pero eso hacía que las 3 tarjetas mostraran cosas distintas en el
 * mismo lugar visual. Se unificó a $ en las 3 para que sean
 * comparables de un vistazo.
 */
function renderGaugeCard(chartKey, canvasId, list) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const chartVar = { gaugeRentC, gaugeCortoC, gaugeLargoC }[chartKey];
  if (chartVar) {
    chartVar.destroy();
    setChart(chartKey, null);
  }

  const wins = list.filter((t) => t.res === "TP");
  const losses = list.filter((t) => t.res === "SL");
  const decisivos = wins.length + losses.length;
  const winRate = decisivos ? Math.round((wins.length / decisivos) * 100) : 0;

  const winsUSD = wins
    .map(tradePnlUSD)
    .filter((v) => v !== null)
    .reduce((a, v) => a + v, 0);
  const lossesUSD = Math.abs(
    losses
      .map(tradePnlUSD)
      .filter((v) => v !== null)
      .reduce((a, v) => a + v, 0),
  );
  const usdVals = list.map(tradePnlUSD).filter((v) => v !== null);
  const netUSD = usdVals.reduce((a, v) => a + v, 0);
  const hasAnyUSD = usdVals.length > 0;

  document.getElementById(`${canvasId}-value`).textContent = hasAnyUSD
    ? fmtUSD(netUSD)
    : "—";
  document.getElementById(`${canvasId}-value`).style.color =
    netUSD >= 0 ? "var(--green)" : "var(--red)";
  document.getElementById(`${canvasId}-wins`).innerHTML =
    `Ganadas (${wins.length})<br>$${winsUSD.toFixed(2)}`;
  document.getElementById(`${canvasId}-winrate`).innerHTML =
    `Tasa de aciertos<br>${winRate}%`;
  document.getElementById(`${canvasId}-losses`).innerHTML =
    `Pérdidas (${losses.length})<br>$${lossesUSD.toFixed(2)}`;

  const green = "#22c55e",
    red = "#ef4444",
    track = "rgba(127,127,127,0.12)";
  setChart(
    chartKey,
    new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: decisivos ? [winRate, 100 - winRate] : [1],
            backgroundColor: decisivos ? [green, red] : [track],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: -90,
        cutout: "72%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    }),
  );
}

/**
 * Las 3 instancias del gauge (Fase 4, bloque 4C — Entrega 29-30):
 * "Rentabilidad" con todos los trades, "Análisis corto"/"Análisis
 * largo" filtrando por dirección (Venta/Compra respectivamente —
 * mapeo confirmado con el usuario, KAME no tiene un campo literal
 * "corto/largo").
 */
function renderDashGauges() {
  if (!document.getElementById("gauge-rent")) return;
  renderGaugeCard("gaugeRentC", "gauge-rent", trades);
  renderGaugeCard(
    "gaugeCortoC",
    "gauge-corto",
    trades.filter((t) => t.dir === "Venta"),
  );
  renderGaugeCard(
    "gaugeLargoC",
    "gauge-largo",
    trades.filter((t) => t.dir === "Compra"),
  );
}

/**
 * Calendario mensual compacto del Dashboard (Fase 4, bloque 4C —
 * Entrega 27). Reemplaza los 2 widgets separados que había antes
 * ("Semana actual" de 7 días + "Heatmap del mes" de puntos sin PnL):
 * ahora es un solo widget mensual con:
 *   - color por día = PnL neto real (no "último trade del día" como
 *     antes) — reutiliza buildGrid()/tradeMapByDate()/summarize() de
 *     calendarPro.js en vez de reimplementar una tercera vez la
 *     agrupación de trades por fecha.
 *   - el día de hoy resaltado con borde.
 *   - la fila completa de la semana actual resaltada con fondo sutil.
 *   - clic en un día navega al Calendario grande y abre su detalle
 *     (reutiliza showDayDetail(), no se duplica el panel).
 * De paso resuelve el bug de huso horario que tenía renderWeekCal()
 * (usaba d.toISOString(), que convierte a UTC) — el nuevo widget nace
 * usando toDs() de calendarPro.js, construido en horario local.
 */
export function renderDashCalendar() {
  const gridEl = document.getElementById("dash-calendar");
  const summaryEl = document.getElementById("dash-heatmap-summary");
  if (!gridEl) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayStr = today();

  const cells = buildGrid(year, month);
  const tradeMap = tradeMapByDate();

  // Fila de la semana actual = la que contiene el día de hoy.
  const todayRowIndex = Math.floor(
    cells.findIndex((c) => c.ds === todayStr) / 7,
  );

  let html = "";
  cells.forEach((cell, i) => {
    const rowIndex = Math.floor(i / 7);
    const isCurrentWeek = rowIndex === todayRowIndex;
    if (!cell.inMonth) {
      html += `<div class="dcal-cell dcal-out${isCurrentWeek ? " dcal-week-hl" : ""}"><span class="dcal-daynum">${cell.day}</span></div>`;
      return;
    }
    const ds = cell.ds;
    const isFuture = ds > todayStr;
    const isToday = ds === todayStr;
    const dayTrades = tradeMap[ds];
    let cls = "dcal-cell";
    let title = ds;
    if (isCurrentWeek) cls += " dcal-week-hl";
    if (isToday) cls += " dcal-today";
    const daynum = `<span class="dcal-daynum">${cell.day}</span>`;
    if (!isFuture && dayTrades?.length) {
      const usdVals = dayTrades.map(tradePnlUSD).filter((v) => v !== null);
      if (usdVals.length) {
        const netUSD = usdVals.reduce((a, v) => a + v, 0);
        cls += netUSD >= 0 ? " dcal-win" : " dcal-loss";
        title = `${ds}: ${dayTrades.length} trade(s) · ${netUSD >= 0 ? "+" : ""}$${netUSD.toFixed(2)}`;
      } else {
        cls += " dcal-nodata";
        title = `${ds}: ${dayTrades.length} trade(s) sin PnL calculable`;
      }
      cls += " dcal-clickable";
      html += `<div class="${cls}" title="${title}" onclick="go('heatmap',null);goToday();showDayDetail('${ds}')">${daynum}</div>`;
      return;
    }
    if (isFuture) cls += " dcal-future";
    html += `<div class="${cls}" title="${title}">${daynum}</div>`;
  });
  gridEl.innerHTML = html;

  if (summaryEl) {
    const monthDs = cells.filter((c) => c.inMonth).map((c) => c.ds);
    const s = summarize(monthDs, tradeMap);
    summaryEl.innerHTML = `
      <span>PnL del mes: <strong style="color:${s.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${s.hasAnyUSD ? (s.netUSD >= 0 ? "+" : "") + "$" + s.netUSD.toFixed(2) : "—"}</strong></span>
      <span>Días operados: <strong>${s.tradingDays}</strong></span>`;
  }
}

export function renderRecentMini() {
  const last = trades.slice(-8).reverse();
  if (!last.length) {
    document.getElementById("dash-recent").innerHTML =
      '<div class="empty">Sin trades aún</div>';
    return;
  }
  document.getElementById("dash-recent").innerHTML = last
    .map((t) => {
      const pnl = tradePnlUSD(t);
      return `
    <div class="recent-row">
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}</span>
      <span style="font-size:12px;font-weight:600;text-align:center">${escapeHTML(t.par)}</span>
      <span class="badge b${escapeHTML(String(t.res).toLowerCase())}" style="justify-self:center">${escapeHTML(t.res)}</span>
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono);text-align:right">RR ${escapeHTML(t.rr) || "—"}</span>
      <span style="font-size:10px;font-family:var(--mono);text-align:right;color:${pnl === null ? "var(--text3)" : pnl >= 0 ? "var(--green)" : "var(--red)"}">${pnl === null ? "—" : fmtUSD(pnl)}</span>
    </div>`;
    })
    .join("");
}

export function renderEquityChart() {
  const ctx = document.getElementById("eq-chart");
  if (!ctx) return;
  if (eqC) {
    eqC.destroy();
    setChart("eqC", null);
  }
  if (!trades.length) {
    ctx.parentElement.innerHTML = '<div class="empty">Sin datos todavía</div>';
    return;
  }
  let cum = 0;
  const lb = [],
    dt = [];
  trades.forEach((t, i) => {
    cum += TradeEngine.resolveRR(t);
    lb.push(`${i + 1}`);
    dt.push(parseFloat(cum.toFixed(2)));
  });
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--acc")
      .trim() || "#00c853";
  setChart(
    "eqC",
    new Chart(ctx, {
      type: "line",
      data: {
        labels: lb,
        datasets: [
          {
            data: dt,
            borderColor: accent,
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: accent,
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            fill: true,
            backgroundColor: accent + "14",
            tension: 0.35,
          },
        ],
      },
      plugins: [
        lastValuePillPlugin(accent, (v) => (v >= 0 ? "+" : "") + v + "R"),
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 40 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0d0f14",
            titleColor: "#e5e7eb",
            titleFont: { size: 11, weight: "600" },
            bodyColor: "#e5e7eb",
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            boxPadding: 4,
            callbacks: {
              title: (items) => `Trade ${items[0].label}`,
              label: (item) =>
                ` RR acumulado: ${item.raw >= 0 ? "+" : ""}${item.raw}R`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#555c72",
              font: { size: 9 },
              maxTicksLimit: 12,
            },
            grid: { display: false },
          },
          y: {
            ticks: { color: "#555c72", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
        },
      },
    }),
  );
}

/**
 * Panel de Challenge en el Dashboard (Fase 4, bloque 4C — Entrega 22).
 * Reusa calcChProgress() de challengeManager.js — no recalcula nada,
 * solo consume 3 campos nuevos que se le agregaron ahí (balance,
 * drawdownUSD, drawdownPct) de forma aditiva.
 */
export function renderDashChallenge() {
  const el = document.getElementById("dash-challenge");
  if (!el) return;
  const ac = challenges.find((c) => c.active);
  if (!ac) {
    el.innerHTML =
      '<div class="empty">Sin Challenge activo. Actívalo en la sección "Tracker challenge".</div>';
    return;
  }
  const p = calcChProgress(ac);
  const color =
    p.pct >= 80 ? "var(--green)" : p.pct >= 40 ? "var(--yellow)" : "var(--acc)";
  el.innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:8px;font-family:var(--mono)">${escapeHTML(ac.nombre)}</div>
    <div class="g2" style="gap:6px;margin-bottom:10px">
      <div class="metric" style="padding:8px"><div class="mv" style="font-size:15px">${fmtUSD(p.balance)}</div><div class="ml"><span class="material-symbols-outlined icons">
wallet
</span>Balance</div></div>
      <div class="metric" style="padding:8px"><div class="mv" style="font-size:15px;color:${p.drawdownUSD > 0 ? "var(--red)" : "var(--text)"}">${p.drawdownUSD > 0 ? "-" : ""}${fmtUSD(p.drawdownUSD)}</div><div class="ml"><span class="material-symbols-outlined icons">
trending_down
</span>Drawdown</div></div>
      <div class="metric" style="padding:8px"><div class="mv" style="font-size:15px;color:${p.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${p.netUSD >= 0 ? "+" : ""}${fmtUSD(p.netUSD)}</div><div class="ml"><span class="material-symbols-outlined icons">
local_atm
</span>P&amp;L USD</div></div>
    </div>
    <div class="prog-wrap"><div class="prog-fill" style="width:${p.pct}%;background:${color}"></div></div>
    <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:4px">${p.pct}% del objetivo</div>`;
}

/**
 * Rendimiento por sesión y por tipo de setup, en el Dashboard (Fase 4,
 * bloque 4C — Entrega 23). Reusa TradeEngine.winRateByField() — no
 * duplica el patrón filter+% que statistics.js ya repite para
 * par/tipo/sesión, solo lo consume desde el motor.
 */
export function renderDashPerformance() {
  const elSes = document.getElementById("dash-perf-ses");
  const elTipo = document.getElementById("dash-perf-tipo");
  if (!elSes || !elTipo) return;
  const row = (r) =>
    `<div class="srow"><span class="slbl">${r.key}</span><div class="bw"><div class="bf" style="width:${r.wr}%;background:${r.wr >= 50 ? "var(--green)" : "var(--red)"}"></div></div><span class="sv" style="color:${r.wr >= 50 ? "var(--green)" : "var(--red)"}">${r.wr}% (${r.count})</span></div>`;
  const bySes = TradeEngine.winRateByField(trades, "ses");
  const byTipo = TradeEngine.winRateByField(trades, "tipo");
  elSes.innerHTML = bySes.length
    ? bySes.map(row).join("")
    : '<div class="empty" style="padding:10px 0;font-size:11px">Sin datos</div>';
  elTipo.innerHTML = byTipo.length
    ? byTipo.map(row).join("")
    : '<div class="empty" style="padding:10px 0;font-size:11px">Sin datos</div>';
}

/**
 * Distribución RR compacta del Dashboard (Fase 4, bloque 4C — Entrega
 * 22). Reusa TradeEngine.rDistribution() directo — mismo cálculo que
 * consume la página de Estadísticas (Entrega 6), cero lógica nueva.
 */
export function renderMiniRDist() {
  const el = document.getElementById("dash-rdist");
  if (!el) return;
  if (!trades.length) {
    el.innerHTML = '<div class="empty">Sin datos</div>';
    return;
  }
  const rdist = TradeEngine.rDistribution(trades);
  const maxCount = Math.max(1, ...rdist.map((b) => b.count));
  el.innerHTML = rdist
    .map((b) => {
      const color =
        b.label.includes("-") || b.label === "< -2R"
          ? "var(--red)"
          : b.label === "0R (BE)"
            ? "var(--yellow)"
            : "var(--green)";
      return `<div class="srow"><span class="slbl">${b.label}</span><div class="bw"><div class="bf" style="width:${(b.count / maxCount) * 100}%;background:${color}"></div></div><span class="sv">${b.count}</span></div>`;
    })
    .join("");
}
