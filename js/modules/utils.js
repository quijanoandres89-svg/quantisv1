/* ============================================================
   UTILS — funciones utilitarias de fecha, formato y semanas
   ------------------------------------------------------------
   Sin estado propio. getWeeks() sí depende de trades/journals
   (importados de state.js) porque necesita saber en qué semanas
   hay datos registrados.
   ============================================================ */

import { trades, journals } from "./state.js";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Fecha (yyyy-mm-dd) de hace N días — mismo método que today()
 * (toISOString) a propósito: journals[] usa claves generadas con
 * today(), así que daysAgo() tiene que calcular con el mismo criterio
 * o la racha de journaling podría desalinearse cerca de medianoche
 * según el huso horario del navegador. */
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtShort(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
  });
}

export function weekStart(d) {
  const dt = new Date(d + "T12:00:00"),
    dow = dt.getDay(),
    m = new Date(dt);
  m.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
  return m.toISOString().slice(0, 10);
}

export function weekEnd(ws) {
  const d = new Date(ws + "T12:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Suma N días a una fecha (yyyy-mm-dd), mismo criterio T12:00:00 que
 * weekStart()/weekEnd() (hora local del mediodía, evita saltos por
 * huso horario/DST). Usado para listar los días lunes-viernes de una
 * semana sin repetir aritmética de fechas en cada módulo que la
 * necesite. */
export function addDaysStr(d, n) {
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** true si la fecha (yyyy-mm-dd) cae en sábado o domingo — forex
 * cierra el viernes y recién reabre el domingo en la noche, así que
 * ningún trader puede journalear un sábado, y un domingo típico
 * tampoco tiene sesión real. Usado por la racha de journaling para
 * que el fin de semana no cuente como día "perdido". */
export function isWeekend(d) {
  const dow = new Date(d + "T12:00:00").getDay();
  return dow === 0 || dow === 6;
}

/** Lista de semanas (lunes de inicio) con datos registrados, más reciente primero. */
export function getWeeks() {
  const all = [
    ...new Set(trades.map((t) => weekStart(t.fecha))),
    ...Object.keys(journals).map((d) => weekStart(d)),
  ].filter(Boolean);
  return [...new Set(all)].sort().reverse();
}

/** Duración legible entre dos horas "HH:MM". */
/**
 * Duración en minutos entre dos horarios "HH:MM" (entrada/cierre de
 * un trade). Extraída de calcDuracion() en la Entrega 28 para poder
 * reutilizar el número crudo en promedios (Dashboard) sin tener que
 * re-parsear el string ya formateado. Devuelve null si falta algún
 * horario o no son horas válidas — mismo criterio de "dato opcional"
 * que TradeEngine.captureEfficiency().
 * ------------------------------------------------------------
 * Bugfix de paso: si el cierre da "menor" que la entrada (cruzó
 * medianoche, ej. entrada 23:30 / cierre 00:15), la versión anterior
 * de calcDuracion() devolvía "" en vez de calcular la duración real
 * — quedaba en silencio, sin avisar que ese trade no se estaba
 * contando. Ahora se asume que cruzó un día (no hay forma de saber la
 * fecha de cierre exacta con los datos que guarda hoy el formulario)
 * y se suman 24h. Verificado sin regresión: para los casos normales
 * (cierre > entrada, sin cruce) el resultado es idéntico a antes.
 */
export function tradeDurationMinutes(entrada, cierre) {
  if (!entrada || !cierre) return null;
  const [eh, em] = entrada.split(":").map(Number);
  const [ch, cm] = cierre.split(":").map(Number);
  if ([eh, em, ch, cm].some((n) => Number.isNaN(n))) return null;
  let mins = ch * 60 + cm - (eh * 60 + em);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

/** Formatea la duración de un trade para mostrarla (Historial). */
export function calcDuracion(entrada, cierre) {
  const mins = tradeDurationMinutes(entrada, cierre);
  if (mins === null || mins <= 0) return "";
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

/**
 * Escapa HTML de texto libre escrito por el usuario (par, notas,
 * nombre de plantilla, etc.) antes de insertarlo en innerHTML.
 * ------------------------------------------------------------
 * Hallazgo de la auditoría (sección 2, XSS 🟠 Alto): varios campos de
 * texto libre se insertaban directo en innerHTML sin escapar. Como la
 * app permite importar un backup .json arbitrario (importBackup(),
 * backup.js) y volcarlo a los arrays de estado, un backup manipulado
 * con HTML/JS embebido en "notas" o "nombre" podía ejecutarse en el
 * navegador del usuario con acceso a todo su localStorage. Usar esta
 * función en cualquier punto donde se renderice texto que el usuario
 * (o un archivo importado) haya escrito, no en HTML fijo de la app.
 */
export function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]
  );
}

/** Formatea un número USD con signo explícito, ej: +$150.00 / -$75.00 */
export function fmtUSD(v) {
  const sign = v >= 0 ? " " : "";
  return `${sign}$${v.toFixed(2)}`;
}

/** Lee el valor resuelto de una variable CSS del tema activo (oscuro/claro). */
export function cssVar(name, fallback = "") {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * Paleta de colores del tema activo, lista para pasar a Chart.js — el
 * canvas 2D no resuelve var(--x) de forma confiable en todos los
 * navegadores, así que los gráficos necesitan el valor ya resuelto.
 * Se llama una vez por render (el tema puede cambiar entre renders si
 * el usuario togglea modo oscuro/claro).
 */
export function themeColors() {
  return {
    acc: cssVar("--acc", "#00c853"),
    green: cssVar("--green", "#00c853"),
    red: cssVar("--red", "#ef4444"),
    yellow: cssVar("--yellow", "#f59e0b"),
    text3: cssVar("--text3", "#555c72"),
  };
}

/**
 * Plugin de Chart.js: línea punteada + badge con el último valor de
 * la serie, pegado al borde derecho del gráfico (estilo dashboard
 * financiero premium). "color" es el acento de la línea (ya resuelto,
 * no un var() de CSS). "fmt" formatea el valor para el badge.
 */
export function lastValuePillPlugin(color, fmt = (v) => v) {
  return {
    id: "lastValuePill",
    afterDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const ds = chart.data.datasets[0];
      if (!ds || !ds.data.length || !meta.data.length) return;
      const i = ds.data.length - 1;
      const point = meta.data[i];
      if (!point) return;
      const { ctx, chartArea } = chart;
      const y = point.y;

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color + "55";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = fmt(ds.data[i]);
      ctx.font = "600 10px 'DM Mono', monospace";
      const textW = ctx.measureText(label).width;
      const padX = 6,
        h = 16,
        r = 4;
      const boxW = textW + padX * 2;
      const boxX = chartArea.right - boxW;
      const boxY = y - h / 2;

      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + h, r);
      ctx.arcTo(boxX + boxW, boxY + h, boxX, boxY + h, r);
      ctx.arcTo(boxX, boxY + h, boxX, boxY, r);
      ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, boxX + padX, y + 0.5);
      ctx.restore();
    },
  };
}
