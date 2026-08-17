/* ============================================================
   CHALLENGE MONITOR (Fase 4, Entrega 13) — módulo independiente
   de monitoreo continuo. No depende del Dashboard; lo consumen
   el sidebar (vista compacta) y la página Challenge (vista
   detallada). Toda la lógica de evaluación vive en RuleEngine
   (Entrega 12) — este módulo es solo presentación.
   ============================================================ */

import { getRuleSet, evaluateChallenge } from "./ruleEngine.js";

const STATUS_ORDER = { violation: 4, "high-risk": 3, warning: 2, "n-a": 1, ok: 0 };
const STATUS_COLOR = {
  violation: "var(--red)",
  "high-risk": "var(--orange)",
  warning: "var(--yellow)",
  ok: "var(--green)",
  "n-a": "var(--text3)",
};
const STATUS_DOT = {
  violation: "sdr",
  "high-risk": "sdr",
  warning: "sdy",
  ok: "sdg",
  "n-a": "sdy",
};
const STATUS_LABEL = {
  violation: "Violación",
  "high-risk": "Riesgo alto",
  warning: "Aviso",
  ok: "OK",
  "n-a": "No evaluado",
};

/** Checks de un Challenge, o [] si no tiene Rule Set vinculado. */
export function checksFor(ch) {
  if (!ch || !ch.ruleSetId) return [];
  const rs = getRuleSet(ch.ruleSetId);
  if (!rs) return [];
  return evaluateChallenge(ch, rs);
}

/** El peor status entre un conjunto de checks (violation > warning > n-a > ok). */
export function worstStatus(checks) {
  if (!checks.length) return null;
  return checks.reduce(
    (worst, c) => (STATUS_ORDER[c.status] > STATUS_ORDER[worst] ? c.status : worst),
    "ok",
  );
}

/**
 * Badge compacto para el sidebar: un punto de color + cuántas reglas
 * están en violación/aviso. Vacío si el Challenge no tiene Rule Set.
 */
export function renderMonitorBadge(ch) {
  const checks = checksFor(ch);
  if (!checks.length) return "";
  const worst = worstStatus(checks);
  const violations = checks.filter((c) => c.status === "violation").length;
  const highRisk = checks.filter((c) => c.status === "high-risk").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  let text = "Reglas OK";
  if (violations > 0) text = `${violations} violación(es)`;
  else if (highRisk > 0) text = `${highRisk} en riesgo alto`;
  else if (warnings > 0) text = `${warnings} aviso(s)`;
  return `<div style="display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px">
    <span class="sdot ${STATUS_DOT[worst]}"></span>
    <span style="color:${STATUS_COLOR[worst]}">${text}</span>
  </div>`;
}

/**
 * Checklist detallado para la tarjeta del Challenge en la página
 * "Challenge". Si no hay Rule Set vinculado, invita a crear/vincular uno
 * en vez de mostrar un bloque vacío.
 */
export function renderMonitorDetailed(ch) {
  const checks = checksFor(ch);
  if (!ch.ruleSetId) {
    return `<div style="font-size:10px;color:var(--text3);font-family:var(--mono);padding:8px 0">
      Sin conjunto de reglas vinculado. Edítalo para elegir uno en "Reglas".
    </div>`;
  }
  if (!checks.length) {
    return `<div style="font-size:10px;color:var(--text3);font-family:var(--mono);padding:8px 0">
      El Rule Set vinculado ya no existe o no tiene reglas configuradas.
    </div>`;
  }
  return `<div style="margin-top:8px">
    ${checks
      .map(
        (c) => `<div class="srow">
        <span class="slbl" style="display:flex;align-items:center;gap:5px">
          <span class="sdot ${STATUS_DOT[c.status]}"></span>${c.label}
        </span>
        <span class="sv" style="color:${STATUS_COLOR[c.status]};text-align:right;max-width:55%;font-size:10px">${c.detail}</span>
      </div>`,
      )
      .join("")}
  </div>`;
}
