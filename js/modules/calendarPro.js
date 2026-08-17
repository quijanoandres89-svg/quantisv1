/* ============================================================
   CALENDAR PRO — calendario mensual con navegación (Entrega 24)
   + resumen semanal lateral (Entrega 25) + unificación del
   criterio de semana en toda la app (Entrega 26, Fase 4).
   Reemplaza el "Mapa de calor" original (12 meses apilados,
   celdas de color por resultado) por un calendario mes a mes con
   PnL $ real por día, más cercano a TradesViz/Edgewonk.
   ------------------------------------------------------------
   Cero cálculos nuevos: agrupa trades por fecha exacta y reutiliza
   tradePnlUSD() (que a su vez usa TradeEngine.pnlUSD internamente)
   — este módulo es solo agrupación por fecha + presentación.
   showDayDetail() (statistics.js) no se tocó: sigue siendo la
   única fuente del panel de detalle al hacer clic en un día.
   ------------------------------------------------------------
   Decisión de arquitectura (Entrega 26 — reemplaza lo decidido en
   la Entrega 25): la grilla ahora arranca en LUNES y el resumen
   semanal usa directamente weekStart()/weekEnd() de utils.js —
   las mismas funciones que ya usan Reporte semanal, Comparar
   semanas y Consistencia. Un solo criterio de "semana" en toda la
   app, sin ambigüedad. También es el mismo criterio que ya usaba
   el widget "Semana actual" del Dashboard (L M X J V S D). Antes
   este módulo pintaba domingo-sábado con semanas armadas trozando
   las propias filas de la grilla — quedaba correcto mirado solo,
   pero era un segundo concepto de "semana" viviendo en paralelo.
   ------------------------------------------------------------
   Estado efímero (mes/año visible) vive como variables locales del
   módulo — mismo patrón que replay.js con su scrubber: ningún otro
   módulo lo necesita ni debe persistir entre sesiones.
   ============================================================ */

import { trades, journals } from "./state.js";
import { today, weekStart, weekEnd } from "./utils.js";
import { tradePnlUSD } from "./tradeManager.js";
import { showDayDetail } from "./statistics.js";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FMT_RANGO = { day: "2-digit", month: "short" }; // "28 jun" — mismo criterio que fmtShort() de utils.js

// Mes visible actualmente — arranca en el mes real de hoy.
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth(); // 0-11

function pad(n) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" en horario local, sin pasar por toISOString (que
 * convierte a UTC y puede correr el día según el huso horario). */
export function toDs(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Construye la grilla completa (siempre múltiplo de 7, hasta 6 filas)
 * para el mes visible, con fecha real (Date + ds) en CADA celda —
 * incluidas las de relleno del mes anterior/siguiente. Arranca en
 * lunes (mismo offset que weekStart() de utils.js: dow===0 → 6,
 * si no dow-1) para que las filas de la grilla coincidan exactamente
 * con las semanas ISO que usa el resto de la app. Se apoya en la
 * normalización automática de Date (sumar/restar días con setDate)
 * en vez de aritmética manual de mes/año, para que los cruces de
 * diciembre→enero o años bisiestos salgan correctos sin casos
 * especiales.
 */
export function buildGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const dow = firstOfMonth.getDay(); // 0=Dom..6=Sáb
  const firstDow = dow === 0 ? 6 : dow - 1; // offset con lunes=0, igual que weekStart()
  const gridStart = new Date(year, month, 1 - firstDow);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      day: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
      ds: toDs(d),
    });
  }
  return cells;
}

/** Agrupa TODOS los trades por fecha exacta — una sola pasada, sin
 * filtrar por mes, porque el resumen semanal necesita días que caen
 * en el mes anterior/siguiente (ej. "30 jun - 6 jul" dentro de la
 * vista de julio). */
export function tradeMapByDate() {
  const map = {};
  trades.forEach((t) => {
    if (!t.fecha) return;
    (map[t.fecha] ||= []).push(t);
  });
  return map;
}

/** PnL neto en USD + conteo de días operados para un conjunto de
 * fechas (ds[]) dado, usando el mapa ya agrupado. Reutilizado tanto
 * por el resumen del header (todo el mes) como por cada tarjeta
 * semanal. */
export function summarize(dsList, tradeMap) {
  let netUSD = 0;
  let hasAnyUSD = false;
  let tradingDays = 0;
  let totalTrades = 0;
  dsList.forEach((ds) => {
    const dayTrades = tradeMap[ds];
    if (!dayTrades || !dayTrades.length) return;
    tradingDays++;
    totalTrades += dayTrades.length;
    const usdVals = dayTrades.map(tradePnlUSD).filter((v) => v !== null);
    if (usdVals.length) {
      hasAnyUSD = true;
      netUSD += usdVals.reduce((a, v) => a + v, 0);
    }
  });
  return { netUSD, hasAnyUSD, tradingDays, totalTrades };
}

// [window] onclick="prevMonth()"
export function prevMonth() {
  viewMonth--;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }
  renderCalendarPro();
}

// [window] onclick="nextMonth()"
export function nextMonth() {
  viewMonth++;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  renderCalendarPro();
}

// [window] onclick="goToday()"
export function goToday() {
  const n = new Date();
  viewYear = n.getFullYear();
  viewMonth = n.getMonth();
  renderCalendarPro();
}

// [window] go('heatmap', ...) la dispara desde main.js (id de página sin
// cambiar — solo cambió lo que se renderiza dentro).
export function renderCalendarPro() {
  const headerEl = document.getElementById("cal-header-title");
  const gridEl = document.getElementById("cal-grid");
  const summaryEl = document.getElementById("cal-summary");
  const weeklyEl = document.getElementById("cal-weekly-summary");
  if (!headerEl || !gridEl) return;

  headerEl.textContent = `${MESES[viewMonth]} ${viewYear}`;

  const tradeMap = tradeMapByDate();
  const cells = buildGrid(viewYear, viewMonth);
  const todayStr = today();

  // --- Resumen del header: PnL total del mes + días operados (solo
  // fechas que pertenecen al mes visible, a diferencia del resumen
  // semanal que sí cruza meses) ---
  const monthDs = cells.filter((c) => c.inMonth).map((c) => c.ds);
  const monthSummary = summarize(monthDs, tradeMap);
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span class="cal-sum-item">PnL: <strong style="color:${monthSummary.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${monthSummary.hasAnyUSD ? (monthSummary.netUSD >= 0 ? "+" : "") + "$" + monthSummary.netUSD.toFixed(2) : "—"}</strong></span>
      <span class="cal-sum-item">Días: <strong>${monthSummary.tradingDays}</strong></span>`;
  }

  // --- Grilla ---
  let html = DIAS_SEMANA.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  cells.forEach((cell) => {
    if (!cell.inMonth) {
      html += `<div class="cal-cell cal-cell-out"><span class="cal-daynum">${cell.day}</span></div>`;
      return;
    }
    const ds = cell.ds;
    const isFuture = ds > todayStr;
    const isToday = ds === todayStr;
    const dayTrades = tradeMap[ds];
    const hasJournal = !!journals[ds];
    const clickable = !isFuture && (dayTrades?.length || hasJournal);

    let inner = `<span class="cal-daynum">${cell.day}</span>`;
    if (!isFuture && dayTrades?.length) {
      const usdVals = dayTrades.map(tradePnlUSD).filter((v) => v !== null);
      if (usdVals.length) {
        const netUSD = usdVals.reduce((a, v) => a + v, 0);
        inner += `
          <div class="cal-daycount">${dayTrades.length} <span class="cal-swap">&#8646;</span></div>
          <div class="cal-daypnl" style="color:${netUSD >= 0 ? "var(--green)" : "var(--red)"}">${netUSD >= 0 ? "+" : ""}$${Math.abs(netUSD) >= 1000 ? (netUSD / 1000).toFixed(1) + "k" : netUSD.toFixed(2)}</div>`;
      } else {
        inner += `<div class="cal-daycount">${dayTrades.length} trade(s)</div>`;
      }
    }

    html += `<div class="cal-cell${isToday ? " cal-cell-today" : ""}${clickable ? " cal-cell-clickable" : ""}"${clickable ? ` onclick="showDayDetail('${ds}')"` : ""}>${inner}</div>`;
  });
  gridEl.innerHTML = html;

  if (weeklyEl) renderWeeklySummary(cells, tradeMap, weeklyEl);
}

/**
 * Resumen semanal (Entrega 25, criterio unificado en la Entrega 26):
 * una tarjeta por cada semana ISO (lunes-domingo) que toca el rango
 * visible del calendario. Las fronteras de cada semana se derivan de
 * weekStart()/weekEnd() de utils.js — no de una segunda
 * implementación local de "inicio de semana" — así que si ese
 * criterio cambia alguna vez, este panel lo sigue automáticamente
 * sin tocar nada acá.
 */
function renderWeeklySummary(cells, tradeMap, container) {
  const firstWs = weekStart(cells[0].ds);
  const lastWs = weekStart(cells[cells.length - 1].ds);
  const fmt = (ds) =>
    new Date(ds + "T12:00:00").toLocaleDateString("es-CO", FMT_RANGO);

  const weeks = [];
  let ws = firstWs;
  while (ws <= lastWs) {
    const we = weekEnd(ws);
    const dsList = [];
    const d = new Date(ws + "T12:00:00");
    for (let i = 0; i < 7; i++) {
      dsList.push(toDs(d));
      d.setDate(d.getDate() + 1);
    }
    weeks.push({ ws, we, dsList });
    const next = new Date(ws + "T12:00:00");
    next.setDate(next.getDate() + 7);
    ws = toDs(next);
  }

  container.innerHTML = weeks
    .map((week, i) => {
      const s = summarize(week.dsList, tradeMap);
      const rango = `${fmt(week.ws)} - ${fmt(week.we)}`;
      const body = s.totalTrades
        ? `<div class="wsum-body">
             <span class="wsum-item">PnL: <strong style="color:${s.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${s.hasAnyUSD ? (s.netUSD >= 0 ? "+" : "") + "$" + s.netUSD.toFixed(2) : "—"}</strong></span>
             <span class="wsum-item">Días: <strong>${s.tradingDays}</strong></span>
           </div>`
        : `<div class="wsum-empty">Sin operaciones</div>`;
      return `<div class="wsum-card">
        <div class="wsum-head"><span class="wsum-title">Semana ${i + 1}</span><span class="wsum-range">${rango}</span></div>
        ${body}
      </div>`;
    })
    .join("");
}
