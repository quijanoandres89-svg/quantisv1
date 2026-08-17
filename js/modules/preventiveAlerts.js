/* ============================================================
   PREVENTIVE ALERTS (Fase 4, Entrega 15) — simula el impacto de
   un trade ANTES de guardarlo. Si guardar este trade haría que
   alguna regla que hoy está bien pase a "violation", se avisa
   antes de persistir nada.
   ------------------------------------------------------------
   No duplica la lógica de evaluación: empuja temporalmente el
   trade hipotético al array compartido de `trades`, reutiliza
   ChallengeMonitor.checksFor() (que a su vez usa RuleEngine), y
   lo retira. JS es de un solo hilo — no hay riesgo de que otro
   código lea el array a medio camino de este push/evaluate/pop.
   ============================================================ */

import { trades } from "./state.js";
import { checksFor } from "./challengeMonitor.js";

/**
 * Devuelve los checks que HOY están bien pero PASARÍAN a "violation"
 * si se guardara este trade. [] si el Challenge no tiene Rule Set
 * vinculado, o si no se rompería ninguna regla nueva.
 */
export function simulateNewViolations(hypotheticalTrade, ch) {
  if (!ch || !ch.ruleSetId) return [];

  const before = checksFor(ch);
  const wasAlreadyViolated = new Set(
    before.filter((c) => c.status === "violation").map((c) => c.key),
  );

  trades.push(hypotheticalTrade);
  let after;
  try {
    after = checksFor(ch);
  } finally {
    trades.pop();
  }

  return after.filter(
    (c) => c.status === "violation" && !wasAlreadyViolated.has(c.key),
  );
}

// [window] onclick="confirmSaveTradeAnyway()" — se conecta en main.js
// (ahí vive porque necesita orquestar TradeManager + refresco de UI,
// mismo patrón que el resto de la app: los módulos de datos no tocan
// UI de otros módulos directamente)

/** Cierra el modal y limpia el RR — abandona el intento de registro. */
// [window] onclick="cancelPreventiveTrade()"
export function cancelPreventiveTrade() {
  document.getElementById("modal-preventive").classList.remove("open");
  document.getElementById("t-rr").value = "";
  document.getElementById("t-res-preview").innerHTML = "";
}

/** Cierra el modal SIN tocar el formulario — para que el usuario ajuste algo. */
// [window] onclick="editPreventiveTrade()"
export function editPreventiveTrade() {
  document.getElementById("modal-preventive").classList.remove("open");
}

/** Arma el contenido del modal con las reglas que se romperían. */
export function renderPreventiveModal(violations) {
  document.getElementById("preventive-list").innerHTML = violations
    .map(
      (c) =>
        `<div class="alert ae">⛔ <strong>${c.label}:</strong> ${c.detail}</div>`,
    )
    .join("");
  document.getElementById("modal-preventive").classList.add("open");
}
