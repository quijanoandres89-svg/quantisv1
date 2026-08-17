/* ============================================================
   ALERT SYSTEM (Fase 4, Entrega 14) — componente único de
   notificaciones con codificación de color, reutilizado en
   Dashboard, Registrar Trade, Calendario y Challenge (tal como
   pide el documento). No duplica lógica de evaluación: consume
   ChallengeMonitor.checksFor(), que a su vez consume RuleEngine.
   ------------------------------------------------------------
   5 colores: azul (info), verde (objetivo cumplido/ok — se omite
   por defecto para no saturar con "todo bien"), amarillo (aviso),
   naranja (riesgo alto), rojo (violación).
   ============================================================ */

import { challenges } from "./state.js";
import { checksFor } from "./challengeMonitor.js";

const CLASS_FOR_STATUS = {
  ok: "as",
  warning: "aw",
  "high-risk": "ao",
  violation: "ae",
  "n-a": "ai",
};
const ICON_FOR_STATUS = {
  ok: "✅",
  warning: "⚠️",
  "high-risk": "🟠",
  violation: "⛔",
  "n-a": "ℹ️",
};

/**
 * Renderiza las alertas de reglas del Challenge activo en el
 * contenedor indicado. Por defecto solo muestra lo que requiere
 * atención (warning/high-risk/violation) — omite "ok" para no
 * saturar la pantalla con confirmaciones de que todo está bien.
 * Pasa { showOk: true } para incluir también las reglas en verde.
 */
export function renderChallengeAlerts(containerId, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const ac = challenges.find((c) => c.active);
  if (!ac) {
    el.innerHTML = "";
    return;
  }
  const checks = checksFor(ac);
  const relevant = checks.filter((c) =>
    options.showOk ? true : c.status !== "ok",
  );
  if (!relevant.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = relevant
    .map(
      (c) =>
        `<div class="alert ${CLASS_FOR_STATUS[c.status]}">${ICON_FOR_STATUS[c.status]} <strong>${c.label}:</strong> ${c.detail}</div>`,
    )
    .join("");
}
